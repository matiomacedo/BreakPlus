/* ==========================================================================
   queue.js — fila de produção com prioridade justa (terminal do bar).

   O problema: uma fila FIFO deixa um pedido grande bloquear tudo; uma fila
   "shortest job first" deixa os pedidos grandes/complexos sem fim. Este motor
   mistura as duas coisas com um limite anti-inanição:

   - Espera (aging): quanto mais tempo na fila, mais depressa sobe. A partir
     de 12 min há um salto fixo que garante que ninguém fica esquecido.
   - Complexidade: fora de horas de ponta, começar cedo o que demora mais;
     em hora de ponta, dar prioridade ao que sai depressa.
   - Quantidade: pedidos grandes levam uma penalização que desaparece com a
     espera (não ficam eternamente atrás dos pequenos).
   - Agrupamento: pedidos com o mesmo produto dominante ganham um bónus e,
     quando a diferença de prioridade é pequena, ficam lado a lado para o
     balcão preparar em série (ex.: vários cafés).
   - Contexto: "low", "peak_rush" (12:00–14:30 e 17:30–19:15) e "closing"
     (últimos 45 min antes das 20:00).

   Uso no terminal:
     QueueEngine.rankOrders(orders, { items: ITEMS, currentTime: Date.now() })
       -> [{ order, position, score, reasoning, breakdown }, ...]

   Uso genérico (devolve o JSON do enunciado):
     QueueEngine.sort({ current_time, orders, items, context })
       -> { sorted_queue: [{ order_id, position, reasoning, priority_score }], ... }

   O motor é determinístico: com os mesmos dados e a mesma hora, a ordem é
   sempre a mesma. Corre também em Node (require) para os testes.
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QueueEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Constantes ajustáveis. Mexer aqui muda o comportamento da fila. */
  const TUNING = {
    agingLinear: 9,          // pontos por minuto de espera
    agingPower: 1.9,         // aceleração da espera
    agingExponent: 1.55,
    starvationAfterMin: 12,  // a partir daqui ninguém fica atrás
    starvationBase: 150,
    starvationPerMin: 40,
    quantityFree: 2,         // itens sem penalização
    quantityPenalty: 4,      // penalização por item extra (fora de ponta)
    quantityPenaltyPeak: 7,
    quantityDecayMin: 7,     // a penalização desaparece ao fim de ~7 min
    prepPenalty: 1,          // pontos por minuto estimado de preparação
    prepPenaltyPeak: 1.6,
    complexityBonusLow: 2,   // começar cedo o que é complexo (fora de ponta)
    complexityPenaltyPeak: 1.5,
    complexityBonusClosing: 1.5,
    simpleBonusPeak: 8,      // item rápido em hora de ponta
    simpleBonusPeakMedium: 3,
    batchBonus: 2.5,         // por outro pedido com o mesmo produto dominante
    batchBonusMax: 8,
    batchBonusPeak: 1.4,
    categoryBonus: 0.75,
    categoryBonusMax: 3,
    closingQuantityBonus: 0.8,
    batchGap: 12,            // diferença máxima de prioridade para agrupar
  };

  const CONTEXT_LABEL = {
    low: 'Fluxo normal',
    peak_rush: 'Hora de ponta',
    closing: 'Fecho',
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const num = (v, fallback) => (Number.isFinite(+v) ? +v : fallback);
  const round1 = (v) => Math.round(v * 10) / 10;

  /** Aceita número (ms), Date ou texto ISO. */
  function toMs(value, fallback) {
    if (value == null) return fallback;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  /** "peak_rush", "closing" ou "low" a partir da hora local. */
  function contextAt(at) {
    const d = at instanceof Date ? at : new Date(toMs(at, Date.now()));
    const minutes = d.getHours() * 60 + d.getMinutes();
    if (minutes >= 19 * 60 + 15) return 'closing';
    if ((minutes >= 12 * 60 && minutes < 14 * 60 + 30)
      || (minutes >= 17 * 60 + 30 && minutes < 19 * 60 + 15)) return 'peak_rush';
    return 'low';
  }

  /** Tabela de produtos: id -> { name, category, complexity (1–5), prepMin }. */
  function itemMap(items) {
    const map = new Map();
    if (items instanceof Map) {
      items.forEach((value, key) => map.set(String(key), value));
      return map;
    }
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item) return;
      const id = String(item.id ?? item.itemId ?? '');
      if (!id) return;
      const complexity = clamp(num(item.complexity, 2), 1, 5);
      map.set(id, {
        id,
        name: item.name || id,
        category: item.category || 'Outros',
        complexity,
        prepMin: clamp(num(item.prepMin, complexity), 0.5, 30),
      });
    });
    return map;
  }

  /** Itens do pedido em [{ id, qty }], aceitando { id: qty } ou uma lista. */
  function entriesOf(order) {
    const raw = order && order.items;
    if (Array.isArray(raw)) {
      return raw.map((entry, index) => {
        if (typeof entry === 'string' || typeof entry === 'number') {
          return { id: String(entry), qty: 1 };
        }
        return {
          id: String(entry.id ?? entry.itemId ?? index),
          qty: Math.max(1, num(entry.qty ?? entry.quantity, 1)),
        };
      });
    }
    if (raw && typeof raw === 'object') {
      return Object.entries(raw)
        .map(([id, qty]) => ({ id: String(id), qty: Math.max(0, num(qty, 0)) }))
        .filter((entry) => entry.qty > 0);
    }
    return [];
  }

  /** Resumo do pedido: quantidade, complexidade média, tempo e produto dominante. */
  function profileOf(order, lookup) {
    const entries = entriesOf(order);
    const counted = entries.reduce((sum, entry) => sum + entry.qty, 0);
    const qty = Math.max(0, num(order && order.total_quantity, counted));

    let weighted = 0;
    let prepMin = 0;
    let dominant = null;
    const categories = new Map();

    entries.forEach(({ id, qty: itemQty }) => {
      const info = lookup.get(id) || { id, name: id, category: 'Outros', complexity: 2, prepMin: 2 };
      weighted += info.complexity * itemQty;
      // Vários iguais preparam-se em série: o segundo café custa menos que o primeiro.
      prepMin += info.prepMin + Math.max(0, itemQty - 1) * info.prepMin * 0.6;
      categories.set(info.category, (categories.get(info.category) || 0) + itemQty);
      if (!dominant || itemQty > dominant.qty) {
        dominant = { id, name: info.name, category: info.category, qty: itemQty };
      }
    });

    const explicitComplexity = num(order && order.complexity_score, 0);
    return {
      entries,
      qty,
      complexity: explicitComplexity > 0
        ? clamp(explicitComplexity, 1, 5)
        : (counted ? weighted / counted : 2),
      prepMin: round1(prepMin || 2),
      dominantId: dominant ? dominant.id : null,
      dominantName: dominant ? dominant.name : '',
      dominantCategory: dominant ? dominant.category : '',
      categoryCount: categories.size,
    };
  }

  /** Ordena por prioridade e aplica o agrupamento de produtos iguais. */
  function rankOrders(orders, options) {
    const opts = options || {};
    const now = toMs(opts.current_time ?? opts.currentTime, Date.now());
    const list = Array.isArray(orders) ? orders : [];
    const context = opts.context
      || (list[0] && list[0].time_of_day_context)
      || contextAt(now);
    const lookup = itemMap(opts.items || opts.itemLookup);

    const ranked = list.map((order) => {
      const created = toMs(order.created_at ?? order.createdAt ?? order.queuedAt, now);
      const ageMin = Math.max(0, (now - created) / 60000);
      const profile = profileOf(order, lookup);
      return {
        order,
        order_id: String(order.order_id ?? order.number ?? order.id ?? ''),
        created,
        ageMin,
        profile,
        score: 0,
        starvation: 0,
        batchGroup: null,
        batchedWith: null,
        breakdown: {},
        reasoning: '',
        position: 0,
      };
    });

    /* Quantos outros pedidos partilham o produto/categoria dominante? */
    const byItem = new Map();
    const byCategory = new Map();
    ranked.forEach((row) => {
      if (row.profile.dominantId) {
        byItem.set(row.profile.dominantId, (byItem.get(row.profile.dominantId) || 0) + 1);
      }
      if (row.profile.dominantCategory) {
        byCategory.set(row.profile.dominantCategory, (byCategory.get(row.profile.dominantCategory) || 0) + 1);
      }
    });

    const peak = context === 'peak_rush';
    const closing = context === 'closing';

    ranked.forEach((row) => {
      const { ageMin, profile } = row;
      const aging = TUNING.agingLinear * ageMin
        + TUNING.agingPower * Math.pow(ageMin, TUNING.agingExponent);
      const starvation = ageMin >= TUNING.starvationAfterMin
        ? TUNING.starvationBase + (ageMin - TUNING.starvationAfterMin) * TUNING.starvationPerMin
        : 0;

      const complexityBonus = closing
        ? profile.complexity * TUNING.complexityBonusClosing
        : peak
          ? -profile.complexity * TUNING.complexityPenaltyPeak
          : profile.complexity * TUNING.complexityBonusLow;

      const quantityPenalty = Math.max(0, profile.qty - TUNING.quantityFree)
        * (peak ? TUNING.quantityPenaltyPeak : TUNING.quantityPenalty)
        * Math.exp(-ageMin / TUNING.quantityDecayMin);

      const prepPenalty = profile.prepMin * (peak ? TUNING.prepPenaltyPeak : TUNING.prepPenalty);

      const simpleBonus = peak
        ? (profile.complexity <= 1.6 && profile.qty <= 2
          ? TUNING.simpleBonusPeak
          : profile.complexity <= 2.5 && profile.qty <= 2 ? TUNING.simpleBonusPeakMedium : 0)
        : 0;

      const sharedItem = Math.max(0, (byItem.get(profile.dominantId) || 1) - 1);
      const sharedCategory = Math.max(0, (byCategory.get(profile.dominantCategory) || 1) - 1);
      const batchBonus = Math.min(TUNING.batchBonusMax, sharedItem * TUNING.batchBonus)
        * (peak ? TUNING.batchBonusPeak : 1)
        + Math.min(TUNING.categoryBonusMax, sharedCategory * TUNING.categoryBonus);

      const closingBonus = closing ? profile.qty * TUNING.closingQuantityBonus : 0;

      row.starvation = starvation;
      row.breakdown = {
        aging: round1(aging),
        starvation: round1(starvation),
        complexity: round1(complexityBonus),
        quantity: -round1(quantityPenalty),
        prep: -round1(prepPenalty),
        simple: round1(simpleBonus),
        batch: round1(batchBonus),
        closing: round1(closingBonus),
      };
      row.score = aging + starvation + complexityBonus - quantityPenalty
        - prepPenalty + simpleBonus + batchBonus + closingBonus;
    });

    ranked.sort((a, b) => b.score - a.score
      || b.ageMin - a.ageMin
      || a.order_id.localeCompare(b.order_id, 'pt', { numeric: true }));

    const grouped = groupBatches(ranked);
    grouped.forEach((row, index) => {
      row.position = index + 1;
      row.reasoning = reasoningFor(row, context);
    });
    return grouped;
  }

  /**
   * Junta pedidos com o mesmo produto dominante quando a prioridade é
   * semelhante (diferença <= batchGap). Nunca move um pedido por cima de
   * outro que tenha mais de batchGap pontos de prioridade.
   */
  function groupBatches(ranked) {
    const list = ranked.slice();
    for (let i = 1; i < list.length; i++) {
      const previous = list[i - 1];
      const current = list[i];
      if (!previous.profile || !previous.profile.dominantId) continue;
      if (current.profile && current.profile.dominantId === previous.profile.dominantId) continue;

      let best = -1;
      for (let j = i + 1; j < list.length; j++) {
        const candidate = list[j];
        if (previous.score - candidate.score > TUNING.batchGap) break;
        if (candidate.profile && candidate.profile.dominantId === previous.profile.dominantId) {
          best = j;
          break;
        }
      }
      if (best === -1) continue;

      const [moved] = list.splice(best, 1);
      list.splice(i, 0, moved);
      moved.batchGroup = previous.profile.dominantName;
      moved.batchedWith = previous;
    }
    return list;
  }

  function reasoningFor(row, context) {
    const parts = [];
    const minutes = Math.floor(row.ageMin);
    if (minutes >= 1) parts.push(`Espera ${minutes} min`);
    if (row.starvation > 0) parts.push('limite anti-inanição');
    if (row.profile.qty >= 4) parts.push(`${row.profile.qty} itens`);
    if (row.profile.complexity >= 3.5) {
      parts.push(`preparação complexa (~${Math.round(row.profile.prepMin)} min)`);
    }
    if (context === 'peak_rush' && row.breakdown.simple > 0) {
      parts.push('hora de ponta: item rápido');
    }
    if (row.batchGroup && row.batchedWith) {
      parts.push(`agrupar com #${row.batchedWith.order_id} (${row.batchGroup})`);
    }
    if (context === 'closing') parts.push('fecho: escoar volume');
    if (!parts.length) parts.push('ordem de chegada');
    return parts.join(' · ');
  }

  /** Formato pedido pelo enunciado, com o detalhe do cálculo para diagnóstico. */
  function sort(input) {
    const opts = Array.isArray(input) ? { orders: input } : (input || {});
    const orders = opts.orders || [];
    const ranked = rankOrders(orders, opts);
    const now = toMs(opts.current_time ?? opts.currentTime, Date.now());
    const context = opts.context
      || (orders[0] && orders[0].time_of_day_context)
      || contextAt(now);
    const oldest = ranked.reduce((max, row) => Math.max(max, row.ageMin), 0);
    const groups = new Map();
    ranked.forEach((row) => {
      if (!row.batchGroup) return;
      const key = row.batchGroup;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row.order_id);
    });

    return {
      sorted_queue: ranked.map((row) => ({
        order_id: row.order_id,
        position: row.position,
        reasoning: row.reasoning,
        priority_score: round1(row.score),
        breakdown: row.breakdown,
      })),
      context,
      context_label: CONTEXT_LABEL[context] || context,
      generated_at: now,
      diagnostics: {
        orders: ranked.length,
        oldest_wait_min: Math.round(oldest * 10) / 10,
        starvation_orders: ranked.filter((row) => row.starvation > 0).map((row) => row.order_id),
        batch_groups: [...groups.entries()].map(([item, ids]) => ({ item, orders: ids })),
        note: 'A espera sobe de forma agressiva e, a partir de 12 min, nenhum pedido fica atrás. '
          + 'Pedidos grandes perdem prioridade só enquanto são recentes; o agrupamento nunca '
          + 'ultrapassa 12 pontos de diferença.',
      },
    };
  }

  return { TUNING, CONTEXT_LABEL, contextAt, profileOf, rankOrders, groupBatches, sort };
});
