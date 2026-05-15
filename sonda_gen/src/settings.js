var APP_CONFIG = {

    // Empresas disponíveis no seletor — key: primeiro dígito do prefixo do veículo
    company: {
        1: 'VPAR TRANSPORTES',
        2: 'Rápido Cuiabá',
    },

    // Seleciona empresa automaticamente com base no prefixo do veículo
    autoSelectCompany: true,

    // Tolerância padrão aplicada a todas as linhas (percentual do ciclo)
    toleranciaDefault: 20,

    // Override de tolerância por linha — deixe vazio {} para usar somente o padrão
    // Exemplo: { '205': 30, 'A22': 20 }
    toleranciaLinhas: {
        '31':  50,
        '32':  50,
        '33':  50,
        '34':  50,
        'A02': 50,
        'A06': 50,
        'A07': 50,
        'A08': 50,
        'A10': 50,
        'A14': 50,
        'A15': 50,
        'A16': 50,
        'A17': 50,
        'A20': 50,
        'A22': 50,
        'C02': 50,
        'R01': 50
    },
};
