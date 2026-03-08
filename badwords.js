const BAD_WORDS = [
  // Français
  'pute', 'putain', 'putes', 'putes',
  'chatte', 'chattes',
  'con', 'conne', 'connards', 'connes',
  'enculé', 'enculée', 'enculer', 'enculés', 'enculées',
  'merde', 'merdes',
  'salope', 'salopes',
  'catin',
  'garce', 'garces',
  'pétasse', 'pétasses',
  'prostituée', 'prostituées', 'puteuse', 'puteuses',
  'bite', 'bites',
  'couille', 'couilles',
  'nichon', 'nichons', 'teton', 'tetons', 'sein', 'seins',
  'foutre', 'niquer', 'nique',
  'ta race', 'ta_gueule', 'ta geule', 'dégage', 'tg',
  'fdp', 'fils de pute',
  'ntm', 'nique ta mère',
  'pd', 'pds', 'pédé', 'pede', 'pedé',
  'tgv', 't球的',
  'batar', 'batard', 'bâtard', 'bâtarde',
  'abruti', 'abrutie', 'abrutis', 'abruties',
  'débile', 'débiles', 'idiot', 'idiote', 'idiots', 'idiotes',
  'imbécile', 'imbéciles',
  'crétin', 'crétine', 'crétins', 'crétines',
  'ordure', 'ordures',
  'parasite', 'parasites',
  'vermine',
  'malade', 'malades',
  'taré', 'tarée', 'tarés', 'tarées',
  'dégueulasse', 'dégoûtant', 'dégoûtante',
  'infect', 'infecte', 'infects', 'infectes',
  'abject', 'abjecte',
  'ignoble',
  'stupide', 'stupides',
  'bête', 'bêtes',
  'vache', 'vaches',
  'cochon', 'cochonne', 'cochons', 'cochonnes',
  'porc', 'porcs',
  'cancre',
  'branleur', 'branleuse', 'branleurs',
  'enculeur', 'enculeuse',
  'casse-couille', 'casse-couilles',
  'salaud', 'salope',
  'gueule', 'ta gueule',
  'ramollo', 'ramollos',
  'brèle', 'brèles',
  'branque',
  'cloche', 'clochard',
  'gogol', 'gogole',
  'gland', 'glands', 'glander',
  'bouffon', 'bouffonne',
  'pleureuse', 'pleureuses',
  'fracas',
  'moche', 'moches',
  'laid', 'laide', 'laids', 'laides',
  'trivial', 'triviaux',
  'vulgaire',
  'obscène',
  'dégoût', 'dégout',
  'pervers', 'pervers', 'perverse',
  'nazi', 'nazis',
  'fasciste', 'fascistes',

  // Anglais
  'shit', 'shits', 'shitted', 'shitting',
  'fuck', 'fucks', 'fucked', 'fucking', 'fucked',
  'fuckyou', 'fuck you', 'fuckyous',
  'ass', 'asses', 'asshole', 'assholes', 'dumbass', 'dumbass',
  'bitch', 'bitches', 'bitchy',
  'bastard', 'bastards',
  'dick', 'dicks', 'dickhead',
  'cock', 'cocks', 'cockhead',
  'pussy', 'pussies',
  'cunt', 'cunts',
  'whore', 'whores', 'hooker', 'hookers',
  'slut', 'sluts', 'slutty',
  'nigger', 'niggers', 'nigga', 'niggas',
  'faggot', 'faggots', 'fag', 'fags',
  'retard', 'retards', 'retarded',
  'crap', 'craps',
  'damn', 'damned', 'dammit',
  'hell', 'hell',
  'piss', 'pissed',
  'douche', 'douches', 'douchebag',
  'cunt',
  'wank', 'wanks', 'wanker',
  'twat',
  'bugger',
  'bollocks',
  'arsehole', 'arse',
  'sob',
  'sodomite',

  // Espagnol
  'joder', 'mierda', 'puta', 'puto', 'coño', 'cabron', 'cabrón', 'culo', 'marica', 'maricón',
];

function normalizeForFilter(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/\$/g, 's')
    .replace(/\s+/g, '');
}

function hasBadWord(str) {
  const normalized = normalizeForFilter(str);
  return BAD_WORDS.some(bad => normalized.includes(normalizeForFilter(bad)));
}

module.exports = { BAD_WORDS, hasBadWord };