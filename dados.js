/* Dados iniciais da viagem. Tudo aqui pode ser editado dentro do app;
   estes valores só são usados na primeira abertura (ou em "Restaurar dados iniciais"). */
window.DADOS_INICIAIS = {
  version: 1,
  routes: [
    {
      id: 'r-navionics',
      name: 'route183 (Navionics)',
      color: '#e83fc6',
      draft: false,
      points: [
        { name: 'Marina do Engenho (saída)', lat: -23.19808, lon: -44.69819, note: 'Calculado a partir da tela do Navionics. Confirme.' },
        { name: 'Waypoint 1', lat: -23.11899, lon: -44.62598, note: '' },
        { name: 'Waypoint 2', lat: -23.26717, lon: -44.45923, note: '' },
        { name: 'Waypoint 3 (fora da Ponta do Boi)', lat: -24.00531, lon: -45.18102, note: '' },
        { name: 'Barra de Icapara', lat: -24.68685, lon: -47.42140, note: "24°41.211'S 47°25.284'W, coordenada exata do Navionics" }
      ]
    },
    {
      id: 'r-interno',
      name: 'Trecho interno até Paranaguá (rascunho)',
      color: '#2ec4d6',
      draft: true,
      points: [
        { name: 'Barra de Icapara', lat: -24.68685, lon: -47.42140, note: '' },
        { name: 'Cananéia', lat: -25.0146, lon: -47.9269, note: 'Aproximado. Ajuste ao canal.' },
        { name: 'Ariri', lat: -25.2155, lon: -48.0420, note: 'Aproximado. Ajuste ao canal.' },
        { name: 'Canal do Varadouro', lat: -25.2300, lon: -48.0900, note: 'Posição aproximada da região. Ajuste.' },
        { name: 'Guaraqueçaba', lat: -25.3069, lon: -48.3297, note: 'Aproximado.' },
        { name: 'Paranaguá', lat: -25.5163, lon: -48.5225, note: 'Aproximado.' }
      ]
    }
  ],
  marks: [
    { id: 'm1', name: 'Paraty', lat: -23.2190, lon: -44.7130, note: 'Paraty → início da Juatinga: 16 NM' },
    { id: 'm2', name: 'Ponta da Juatinga', lat: -23.2900, lon: -44.5030, note: 'Aproximado. Contorno da Juatinga: 8,5 NM' },
    { id: 'm3', name: 'Ponta das Canas (farol)', lat: -23.7279, lon: -45.3415, note: 'Juatinga → Ponta das Canas: proa 271° bússola, 45 NM' },
    { id: 'm4', name: 'Canal de Ilhabela', lat: -23.8000, lon: -45.3900, note: 'Aproximado. Dentro do canal: 12 NM' },
    { id: 'm5', name: 'Ponta do Boi (farol)', lat: -23.9669, lon: -45.2516, note: 'Passar 1/4 NM por fora. Ponta do Boi → Moela: proa 286° bússola, 49 NM' },
    { id: 'm6', name: 'Ilha da Moela (farol)', lat: -24.05056, lon: -46.26333, note: 'Moela → Barra de Icapara: proa 260° bússola, 75 NM' },
    { id: 'm7', name: 'Ilha do Bom Abrigo (farol)', lat: -25.1234, lon: -47.8621, note: 'Entrada da barra de Cananéia' }
  ]
};
