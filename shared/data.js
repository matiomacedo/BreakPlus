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
  daysAhead: 3,           // quantos dias com horários mostrar
  cancelBeforeMin: 30,    // até quanto tempo antes se pode cancelar com reembolso
};

const CATEGORIES = ['Todos', 'Tostas & Snacks', 'Pastelaria', 'Bebidas'];
const PERIODS    = ['Todos', 'Destaques', 'Almoço', 'Jantar', 'Bar'];

/* Pratos.
   - image:    caminho da foto, relativo à raiz do projeto (pasta images/).
               Se o ficheiro não existir, aparece um ícone neutro no lugar.
   - tagStyle: 'green' para a etiqueta verde (omitir = etiqueta dourada).
   - meta:     texto no canto da imagem (tempo, volume...). Opcional.
   - badges:   [{ text, style }] — style: 'veg' (verde), 'warn' (amarelo) ou omitido.
   - periods:  em que filtros de "Período" o prato aparece. */
const ITEMS = [
  {
    id: 1,
    image: 'images/tosta-mista-pão-rustico.png',
    category: 'Tostas & Snacks',
    subtitle: 'Tostas especiais',
    name: 'Tosta Mista em Pão Rústico',
    description: 'Pão alentejano tostado, queijo flamengo derretido e fiambre da perna.',
    price: 2.20,
    priceLabel: 'Bar Estudante',
    tag: 'Mais pedido',
    meta: '~4 min',
    badges: [{ text: 'Pão Alentejano' }, { text: 'Favorito' }],
    periods: ['Destaques', 'Almoço', 'Bar'],
  },
  {
    id: 2,
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
    periods: ['Destaques', 'Bar'],
  },
  {
    id: 3,
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
    periods: ['Destaques', 'Almoço', 'Jantar', 'Bar'],
  },
  {
    id: 5,
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
    image: 'images/cafe-nata.png',
    category: 'Pastelaria',
    subtitle: 'Menu pequeno-almoço / lanche',
    name: 'Café Espresso + Pastel de Nata',
    description: 'Espresso Delta de lote superior acompanhado pelo autêntico pastel de nata estaladiço com canela.',
    price: 1.20,
    priceLabel: 'Preço Combo',
    tag: 'Combo económico',
    badges: [{ text: 'Delta Cafés' }, { text: 'Canela & Açúcar', style: 'warn' }],
    periods: ['Destaques', 'Almoço'],
  },
];

const TOPUP_AMOUNTS = [5, 10, 20, 50];

/* As fotos estão em images/ na raiz do projeto. A app do terminal vive em terminal/,
   por isso o <html> dela tem data-base="../" para os caminhos continuarem a funcionar. */
const ASSET_BASE = document.documentElement.dataset.base || '';
const imageUrl = (item) => (item.image ? ASSET_BASE + item.image : '');
