var APP_CONFIG = {

    // Empresas disponíveis no seletor — key: primeiro dígito do prefixo do veículo
    company: {
        1: 'VPAR TRANSPORTES',
        2: 'Rápido Cuiabá',
    },

    // Seleciona empresa automaticamente com base no prefixo do veículo
    autoSelectCompany: true,

    // Tolerância padrão aplicada a todas as linhas (percentual do ciclo)
    toleranciaDefault: 50,

    // Override de tolerância por linha — deixe vazio {} para usar somente o padrão
    // Exemplo: { '205': 30, 'A22': 20 }
    toleranciaLinhas: {
        'A22B': 5,
    },

};
