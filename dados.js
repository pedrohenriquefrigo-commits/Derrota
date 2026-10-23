/* Dados iniciais da viagem. Tudo aqui pode ser editado dentro do app;
   estes valores só são usados na primeira abertura (ou em "Restaurar dados iniciais"). */
window.DADOS_INICIAIS = {
  version: 1,
  routes: [
    {
      id: 'r-184',
      name: 'route184 (Navionics)',
      color: '#e83fc6',
      draft: false,
      points: [
        { name: 'Marina do Engenho (saída)', lat: -23.19808, lon: -44.69818, note: 'Aproximado. Confira.' },
        { name: 'Waypoint 1', lat: -23.18870, lon: -44.65505, note: '' },
        { name: 'Waypoint 2', lat: -23.18245, lon: -44.64187, note: '' },
        { name: 'Waypoint 3', lat: -23.19653, lon: -44.57775, note: 'Coordenada de um toque na linha, perto do ponto. Confira.' },
        { name: 'Waypoint 4 (Ilha Deserta)', lat: -23.21637, lon: -44.54948, note: '' },
        { name: 'Waypoint 5 (Ponta da Juatinga)', lat: -23.29652, lon: -44.49407, note: '' },
        { name: 'Waypoint 6 (Ilha Cairuçu)', lat: -23.34747, lon: -44.57105, note: '' },
        { name: 'Waypoint 7 (Ponta Negra)', lat: -23.37322, lon: -44.60240, note: '' },
        { name: 'Waypoint 8 (Ponta das Canas)', lat: -23.72403, lon: -45.35167, note: 'Coordenada de um toque na linha, ao sul do ponto. Confira.' },
        { name: 'Waypoint 9 (Canal de São Sebastião)', lat: -23.82300, lon: -45.39408, note: '' },
        { name: 'Barra de Icapara', lat: -24.69092, lon: -47.41332, note: '' }
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
