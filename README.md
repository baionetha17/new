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

## Onde mexer
- `shared/sim.js`: tanques (blindagem, módulos, munições, mobilidade) e balística.
- `shared/map.js`: gerador de mapas (Kursk e Normandia).
- `host/`: servidor da sala (salas, partida, IA), roda num Web Worker no navegador de quem hospeda.
- `ui.js`: telas e a conexão PeerJS; `game.js`, `render.js`, `audio.js`: partida, desenho, HUD e som.
- `vendor/peerjs.min.js`: PeerJS 1.5.4 (licença MIT em `vendor/peerjs-LICENSE`).

Para rodar localmente, sirva a pasta com qualquer servidor estático, por exemplo `python -m http.server`, e abra `http://localhost:8000`.
