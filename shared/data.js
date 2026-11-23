/* ==========================================================================
   shared/data.js — conteúdo partilhado pelas duas apps (alunos e terminal).
   Para adicionar um prato: copia um objeto de ITEMS, muda o id e os campos.
   ========================================================================== */

/* O bar (único local). "prep" = tempo de preparação estimado de um pedido na hora.
   A fila atual (tempo de espera) é calculada pelo servidor a partir dos pedidos em curso (ver shared/api.js). */
const BAR = {
  name: 'Bar Central ESTG',
  status: 'Aberto agora',
  open: '08:00',
  close: '20:00',
  prep: '~5 min',
};

/* Regras das reservas (levantamento mais tarde, pago com saldo). */
const RESERVATION = {
  stepMin: 30,            // intervalo entre horas disponíveis
  minLeadMin: 30,         // antecedência mínima para reservar (só afeta "hoje")
  cancelBeforeMin: 30,    // até quanto tempo antes se pode cancelar com reembolso
  todayUntil: '18:00',    // no dia atual, a última hora de levantamento é 18:00
  slotCapacity: 10,       // máximo de reservas por hora de levantamento (o servidor recusa as seguintes)
};

const CATEGORIES = ['Todos', 'Tostas & Snacks', 'Pastelaria', 'Bebidas'];
const PERIODS    = ['Todos', 'Destaques', 'Almoço', 'Jantar', 'Bar'];

/* Pratos.
   - image:    caminho da foto, relativo à raiz do projeto (pasta images/).
               Se o ficheiro não existir, aparece um ícone neutro no lugar.
   - tag:      etiqueta na foto (opcional). "Mais pedido" não se escreve aqui: vem dos pedidos reais
               (servidor) e aparece nos produtos mais pedidos dos últimos dias.
   - tagStyle: 'green' para a etiqueta verde (omitir = etiqueta dourada).
   - meta:     texto no canto da imagem (tempo, volume...). Opcional.
   - badges:   [{ text, style }] — style: 'veg' (verde), 'warn' (amarelo) ou omitido.
   - periods:  em que filtros de "Período" o prato aparece ("Destaques" = os mais pedidos, calculado). */
const ITEMS = [
  {
    id: 1,
    complexity: 4,            // 1–5: usado pela fila com prioridade justa (shared/queue.js)
    prepMin: 4,               // minutos estimados de preparação
    image: 'images/tosta-mista-pão-rustico.png',
    category: 'Tostas & Snacks',
    subtitle: 'Tostas especiais',
    name: 'Tosta Mista em Pão Rústico',
    description: 'Pão alentejano tostado, queijo flamengo derretido e fiambre da perna.',
    price: 2.20,
    priceLabel: 'Bar Estudante',
    meta: '~4 min',
    badges: [{ text: 'Pão Alentejano' }, { text: 'Favorito' }],
    periods: ['Almoço', 'Bar'],
  },
  {
    id: 2,
    complexity: 2,
    prepMin: 2,
    image: 'images/croissant-misto.png',
    category: 'Pastelaria',
    subtitle: 'Pastelaria salgada',
    name: 'Croissant Misto Quentinho',
    description: 'Massa folhada artesanal tostada, queijo derretido e fiambre.',
    price: 1.60,
    priceLabel: 'Preço Bar',
    tag: 'Fornada recente',
    tagStyle: 'green',
    badges: [{ text: 'Folhado' }, { text: 'Na hora' }],
    periods: ['Bar'],
  },
  {
    id: 3,
    complexity: 1,
    prepMin: 1,
    image: 'images/donut-glaze-chocolate.png',
    category: 'Pastelaria',
    subtitle: 'Pastelaria doce',
    name: 'Donut Glaze com Cobertura de Chocolate',
    description: 'Massa fofa e macia com cobertura de cacau belga e acabamento nevado.',
    price: 1.30,
    priceLabel: 'Preço Bar',
    tag: 'Pastelaria do dia',
    badges: [{ text: 'Vegetariano', style: 'veg' }, { text: '280 kcal' }],
    periods: ['Bar'],
  },
  {
    id: 4,
    complexity: 3,
    prepMin: 3,
    image: 'images/sumo-laranja-natural.png',
    category: 'Bebidas',
    subtitle: 'Sumos & vitaminas',
    name: 'Sumo de Laranja Natural',
    description: 'Laranjas do Algarve espremidas no momento do pedido. Sem açúcares adicionados.',
    price: 1.80,
    priceLabel: 'Preço Bar',
    tag: '100% fruta',
    tagStyle: 'green',
    meta: '300 ml',
    badges: [{ text: 'Natural', style: 'veg' }, { text: 'Sem açúcar adicionado' }],
    periods: ['Almoço', 'Jantar', 'Bar'],
  },
  {
    id: 5,
    complexity: 1,
    prepMin: 1,
    image: 'images/frize.png',
    category: 'Bebidas',
    subtitle: 'Bebidas frescas',
    name: 'Frize Limão / Groselha',
    description: 'Água mineral natural gaseificada com aroma refrescante de limão ou groselha.',
    price: 1.35,
    priceLabel: 'Preço Bar',
    tag: 'Fresco',
    badges: [{ text: 'Sem álcool', style: 'veg' }, { text: 'Garrafa de vidro' }],
    periods: ['Almoço', 'Jantar', 'Bar'],
  },
  {
    id: 6,
    complexity: 2,
    prepMin: 2,
    image: 'images/cafe-nata.png',
    category: 'Pastelaria',
    subtitle: 'Menu pequeno-almoço / lanche',
    name: 'Café Espresso + Pastel de Nata',
    description: 'Espresso Delta de lote superior acompanhado pelo autêntico pastel de nata estaladiço com canela.',
    price: 1.20,
    priceLabel: 'Preço Combo',
    tag: 'Combo económico',
    badges: [{ text: 'Delta Cafés' }, { text: 'Canela & Açúcar', style: 'warn' }],
    periods: ['Almoço'],
  },
];

/* Preferências alimentares de cada produto: alimentam os interruptores do ecrã "Mais". */
const DIETARY = {
  1: [],                                               // tosta com fiambre
  2: [],                                               // croissant com fiambre
  3: ['vegetarian'],                                   // donut
  4: ['vegetarian', 'glutenFree', 'lactoseFree'],       // sumo de laranja
  5: ['vegetarian', 'glutenFree', 'lactoseFree'],       // água com aroma
  6: ['vegetarian'],                                   // café + pastel de nata
};
ITEMS.forEach((item) => { item.dietary = DIETARY[item.id] || []; });

const TOPUP_AMOUNTS = [5, 10, 20, 50];

/* As fotos estão em images/ na raiz do projeto. A app do terminal vive em terminal/,
   por isso o <html> dela tem data-base="../" para os caminhos continuarem a funcionar. */
const ASSET_BASE = document.documentElement.dataset.base || '';
const imageUrl = (item) => (item.image ? ASSET_BASE + item.image : '');
