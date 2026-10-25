# Tanque X1

Jogo de tanque da 2ª Guerra para o navegador, com câmera isométrica e balística do Banco de Provas. Por enquanto: Panzer IV F2 e M4A1 Sherman, mapas Kursk e Normandia.

**Jogar:** https://baionetha17.github.io/new/

## Como jogar com os amigos
1. Abra o link, escreva seu nome e clique em **Criar sala**.
2. Passe o código de 4 letras, ou use **Copiar convite** e mande o link.
3. Os amigos abrem o mesmo link, digitam o código e clicam em **Entrar na sala**.
4. Na sala, cada tanque leva 1 ou 2 jogadores: motora (dirige) e torre (mira e atira). Para testar sozinho, ponha uma IA no outro time.

Não precisa de Radmin nem de servidor. Quem cria a sala hospeda a partida no próprio navegador e os amigos se conectam direto nele (WebRTC, via PeerJS). Quem hospeda precisa deixar a aba aberta; se fechar, a sala acaba. Em algumas redes muito fechadas (internet de empresa, alguns 4G) a conexão direta pode falhar; aí troque quem hospeda.

## Modos
- Mata-mata: uma vida por tanque.
- Dominação: zona no meio do mapa, renasce em 10 s, vence com 100 pontos.
- Mata-mata infinito: renasce em 8 s, vence quem chegar ao número de abates.

## Cenário destrutível
Casas, árvores, muros, cercas, sebes, palheiros, carroças, caminhões abandonados, sacos de areia e postes são voxels de 10 cm, como os tanques. Tiro abre buraco, HE derruba árvore e poste, palha e feno pegam fogo, e HE deixa cratera que freia o tanque. O mapa continua plano.

As casas são geradas na hora: isbás de barro ou de toras em Kursk, casas de pedra e celeiros na Normandia, viradas em qualquer uma de 32 direções (seguindo a curva da estrada, com desvios), com um ou dois andares, cômodos, paredes internas, portas, escada, assoalho e móveis (cama, mesa, cadeiras, armário, fogão, prateleiras, quadros, tapete). Dá para ver e atirar pelas janelas, e o vidro estilhaça. A estrutura é de verdade: o que perde o apoio cai e vira entulho, e o fogo se espalha devagar (uns 10 cm por segundo), cada material queima no seu tempo (palha rápido, assoalho devagar, tora quase nunca) e apaga sozinho depois de 3 a 4 minutos. HE só incendeia uma casa de vez em quando. O tanque atravessa parede devagar (pedra mais devagar que madeira). De perto, as casas perto do centro da tela aparecem em corte, sem telhado. Cada casa guarda o mapa dos cômodos, portas, janelas e escadas (`pr.nav`), pronto para tropas a pé no futuro.

De perto o chão ganha detalhe: tufos de grama, fileiras de lavoura, torrões e pedrinhas na estrada, sem perder o pixel.

Os campos dourados são trigo alto que balança com o vento e fica deitado por onde o tanque passa; de perto aparecem tufos de grama. Há arbustos redondos na beira dos campos e perto das casas, e fios de telégrafo entre os postes (poste derrubado arrebenta o fio). Explosão grande levanta onda de poeira, dá um clarão e solta brasas; HE deixa o aço chamuscado onde acertou. Tanque destruído solta uma coluna de fumaça preta.

Há matas de contorno irregular, com árvores, mudas e arbustos em voxel sobre chão de folhas. O tanque esmaga mudas e arbustos (com barulho de galho quebrando) e perde embalo nas árvores. Dentro da mata o tanque fica camuflado: parado só é visto a 55 m, andando a 95 m; encostado num arbusto ou sebe, a 90/160 m, até ter esmagado demais a folhagem. Sem comandante o tanque enxerga 20% menos. O HUD mostra "camuflado: visto a X m".

De perto o trigo vira talos de voxel com espiga. HE no trigo pode atear fogo (35% das vezes): ele corre a favor do vento, devagar contra ele, solta fumaça que tapa a visão e deixa o campo preto.

O tanque atravessa parede gastando o embalo: cada voxel quebrado custa energia (pedra mais que madeira e barro), então ele perde um pouco de velocidade e segue.

## Armas e visão
- **Canhão:** clique. **Metralhadora coaxial:** segure Espaço; ela segue a torre, tem fita (troca demorada sem municiador) e munição real. As balas quebram vidro, lascam madeira e pedra e não furam blindagem.
- **Metralhadora do casco:** atira sozinha em soldados (quando houver) dentro do arco da bola, se o metralhador estiver vivo.
- **Fumaça (G):** o Sherman dispara o morteiro de 2" na direção do canhão (35 a 150 m, 12 granadas); o Panzer joga óleo na descarga e solta uma cortina atrás (3 vezes). A fumaça corta a linha de visão.
- **Névoa de guerra:** o time divide a visão; casas, sebes e fumaça fazem sombra. O que ninguém vê fica escurecido, e o inimigo que sumiu deixa um contorno por 10 s. O servidor é quem esconde os inimigos; a névoa é só o desenho.
- **Câmera de acerto:** cada tiro seu que acerta um tanque abre, no canto superior esquerdo, um raio-X em câmera lenta: o caminho do projétil, a placa atingida, penetração x blindagem efetiva, estilhaços e os módulos e tripulantes atingidos. Quando você é atingido, um painel menor "Fomos atingidos" aparece embaixo. **H** revê o último acerto.
- Cada tripulante morto solta uma caveirinha que sobe da posição dele no tanque.
- Com um tanque visto dentro de uma casa, o telhado fica meio transparente.

## Onde mexer
- `shared/sim.js`: tanques (blindagem, módulos, munições, mobilidade) e balística.
- `shared/map.js`: gerador de mapas (Kursk e Normandia), modelos dos objetos e as contas de destruição (servidor e navegadores fazem as mesmas).
- `host/`: servidor da sala (salas, partida, IA), roda num Web Worker no navegador de quem hospeda.
- `hitcam.js`: câmera de acerto (raio-X).
- `ui.js`: telas e a conexão PeerJS; `game.js`, `render.js`, `audio.js`: partida, desenho, HUD e som.
- `vendor/peerjs.min.js`: PeerJS 1.5.4 (licença MIT em `vendor/peerjs-LICENSE`).

Para rodar localmente, sirva a pasta com qualquer servidor estático, por exemplo `python -m http.server`, e abra `http://localhost:8000`.
