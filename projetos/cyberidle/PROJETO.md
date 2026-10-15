# Cyberidle

Projeto do Lab Hub (slug `cyberidle`), criado em 15/10/2026.

## Ideia

Idle game no formato do BaiakIdle, com tema cyberpunk: hackers, augments, corporações, neon e megacidades.

## Objetivo

Construir o jogo em pequenas fases, testando cada mecânica antes de avançar, com toda a lógica no navegador para não pesar o servidor.

## Fase

Beta.

## Onde mora (e só aqui)

| O quê | Onde |
| --- | --- |
| Tela | `public/projetos/cyberidle/` |
| Servidor (rotas `/api/p/cyberidle/...`) | `projetos/cyberidle/api.js` |
| Tabelas | prefixo `cyberidle_`, migrations `migrations/NNNN_cyberidle_*.sql` |
| Esta ficha | `projetos/cyberidle/PROJETO.md` |

## Conceito (do dono, 15/10/2026)

| BaiakIdle | Cyberidle |
| --- | --- |
| Monstros | Alvos: Rogue Bots, Drones de Vigilância, Hackers Rivais, ICE de corporações |
| Hunts | Distritos/redes: Subsolo Neon, Grid Corporativo, Mainframe Central, Beco Cibernético |
| Level / Magic Level | System Level / Processing Power (GFLOPS) |
| Skills | Cyberware Overclock, Hacking Protocol, Hardware Efficiency |
| Loot / Gold | Creds e componentes (chips, hardware) |
| Equipamentos | Augments: Placa Neural, Processador Óptico, Braço Cibernético |

## Fases

1. **Protótipo mínimo jogável** (feito): combate automático, alvo com barra de integridade,
   Creds e XP, level up, painel do operador, upgrade de Overclock.
2. Inventário e loot caindo dos alvos; troca de distritos (seletor de hunts).
3. Loja de implantes; salvar no servidor; ganho offline com a aba fechada.

## Estado

- Fase 1 no ar em `/projetos/cyberidle/` (atalho `/cyberidle`). Conferida em print no PC
  (1280) e no celular (390): sem erro, sem rolagem lateral, progresso sobrevive ao recarregar.
- Progresso salvo só no navegador (localStorage, chave `cyberidle.progresso.v1`).

## Decisões

- 15/10/2026 - **Servidor da Fase 3 é a Cloudflare (Functions + D1), não a VPS.** O plano
  original falava em Node.js na VPS; mas a VPS é só a máquina de desenvolvimento, e o hub
  já roda na Cloudflare pessoal do dono, de graça e sem máquina ligada. A API responde em
  `/api/p/cyberidle/...` e as tabelas levam o prefixo `cyberidle_`.
- 15/10/2026 - Ajustes no protótipo do dono: recompensa acompanha a vida do alvo (no
  original o alvo crescia 5% por abate e o ganho ficava fixo: o jogo travava); vários level
  ups num abate; loop pelo tempo real (aba em segundo plano continua ganhando, até 5 min);
  salvamento no navegador antecipado da Fase 3 para não perder tudo ao recarregar; botão
  "Reiniciar progresso" com confirmação; botão de upgrade apagado sem Creds; textos em
  português; uma coluna no celular.
