import { useState } from 'react';
import { WindowHead } from './WindowHead.js';

/**
 * Boas-vindas do Cyberidle para quem chega pelo link: 4 telas curtas, uma vez por
 * navegador (pode ser revista pela aba Help). Substitui o tutorial do jogo original.
 * Lab Hub, Claude (Opus 5.5), 27/10/2026.
 */

const CHAVE = 'cyberidle.boasvindas.v1';

export function jaViuBoasVindas(): boolean {
  try { return localStorage.getItem(CHAVE) === '1'; } catch { return true; }
}

function marcarVisto(): void {
  try { localStorage.setItem(CHAVE, '1'); } catch { /* sem armazenamento */ }
}

const TELAS: Array<{ titulo: string; texto: string[]; icone: string }> = [
  {
    icone: '◢◤',
    titulo: 'Bem-vindo ao Cyberidle',
    texto: [
      'Um idle cyberpunk: seu personagem caça sozinho nos distritos da megacidade, ganha XP, sobe de nível e junta loot.',
      'Ele continua progredindo mesmo com a aba fechada. Volte quando quiser para colher o resultado.',
    ],
  },
  {
    icone: '⌖',
    titulo: 'Caçadas e waves',
    texto: [
      'Clique no nome da caçada, em cima do mapa, para escolher onde caçar. A lista mostra o nível indicado e o XP por hora.',
      'Cada caçada tem 10 waves; na última vem o chefe. Deixe o "Loop" ligado para recomeçar sozinho.',
      'O que cai dos inimigos vai para o Loot Pouch: venda por Edinho ou guarde no armazém.',
    ],
  },
  {
    icone: '⚙',
    titulo: 'Helper, equipamento e party',
    texto: [
      'No Helper você escolhe magias, cura e poções. No painel Set, "Organizar" compra o melhor equipamento que o seu Edinho paga.',
      'Com os slots de party, até 2 personagens seus caçam junto: cada um luta, cura e toma poção pelo Helper dele.',
    ],
  },
  {
    icone: '☁',
    titulo: 'Conta, nuvem e ranking',
    texto: [
      'Crie uma conta (ou reivindique o convidado) para salvar na nuvem e abrir o mesmo personagem no PC e no celular.',
      'Com conta você entra no Rank geral e usa o Mercado entre jogadores, que só aceita itens que caíram em caçada.',
    ],
  },
];

export function BoasVindas({ convidado, onFechar }: { convidado: boolean; onFechar: () => void }) {
  const [tela, setTela] = useState(0);
  const atual = TELAS[tela]!;
  const ultima = tela === TELAS.length - 1;
  const fechar = () => { marcarVisto(); onFechar(); };
  return (
    <div className="modal boas-vindas" onClick={fechar}>
      <div className="helper-card boas-vindas-card" onClick={(event) => event.stopPropagation()}>
        <WindowHead title={`${tela + 1} / ${TELAS.length}`} onClose={fechar} closeLabel="Pular" />
        <div className="boas-vindas-corpo">
          <div className="boas-vindas-icone" aria-hidden>{atual.icone}</div>
          <h2>{atual.titulo}</h2>
          {atual.texto.map((linha) => <p key={linha}>{linha}</p>)}
          {ultima && convidado && (
            <p className="boas-vindas-dica">Você está como convidado: o progresso fica só neste navegador até reivindicar a conta (formulário sobre o mapa).</p>
          )}
        </div>
        <div className="boas-vindas-rodape">
          <div className="boas-vindas-pontos">
            {TELAS.map((_, i) => (
              <button key={i} type="button" className={i === tela ? 'on' : ''} aria-label={`Tela ${i + 1}`} onClick={() => setTela(i)} />
            ))}
          </div>
          <div className="row">
            {tela > 0 && <button type="button" className="btn" onClick={() => setTela(tela - 1)}>Voltar</button>}
            <button type="button" className="btn gold" onClick={() => (ultima ? fechar() : setTela(tela + 1))}>
              {ultima ? 'Começar' : 'Próximo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
