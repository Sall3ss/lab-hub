import { useEffect, useState } from 'react';
import type { CharacterView } from '../api/types.js';
import { corDaPaleta, PALETA_NEON, retratoJogador } from '../render/neonAtores.js';
import { WindowHead } from './WindowHead.js';

/**
 * Visual do Cyberidle - substitui a janela de Outfit do jogo original (roupas, montarias,
 * addons e a paleta de cores do Tibia). O personagem é a arte da classe; aqui se escolhe a
 * cor neon dela (PALETA_NEON), com prévia, e os 3 presets.
 * Lab Hub, Claude (Opus 5.5), 31/10/2026.
 */

export type OutfitDraft = {
  outfit: number;
  head: number;
  body: number;
  legs: number;
  feet: number;
  addons: number;
  mount: number;
  aura: number;
  corNeon: number;
};

function fromAppearance(character: CharacterView): OutfitDraft {
  const a = character.appearance;
  return {
    outfit: a.outfit,
    head: a.head,
    body: a.body,
    legs: a.legs,
    feet: a.feet,
    addons: a.addons ?? 0,
    mount: 0,
    aura: a.aura ?? 0,
    corNeon: a.corNeon ?? 0,
  };
}

const nomeDaCor = (corNeon: number | undefined) => PALETA_NEON[corNeon ?? 0]?.nome ?? 'Original';

function Retrato({ vocationId, corNeon, tamanho }: { vocationId: number; corNeon: number; tamanho: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    void retratoJogador(vocationId, corNeon, tamanho).then((url) => { if (vivo) setSrc(url); });
    return () => { vivo = false; };
  }, [vocationId, corNeon, tamanho]);
  return src ? <img src={src} alt="" width={tamanho} height={tamanho} draggable={false} /> : <span className="meta">…</span>;
}

export function OutfitModal({
  character,
  busy,
  onClose,
  onApply,
  onPresetSave,
  onPresetLoad,
}: {
  character: CharacterView;
  busy: boolean;
  onClose: () => void;
  onApply: (draft: OutfitDraft) => Promise<void>;
  onPresetSave: (slot: number) => Promise<void>;
  onPresetLoad: (slot: number) => Promise<OutfitDraft | void>;
}) {
  // Rascunho local: só grava no "Aplicar" (Cancelar não deixa rastro).
  const [draft, setDraft] = useState<OutfitDraft>(() => fromAppearance(character));
  const [hint, setHint] = useState('');
  const vocationId = character.vocation.id;
  const mudou = draft.corNeon !== (character.appearance.corNeon ?? 0);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card outfit-modal visual-modal" onClick={(event) => event.stopPropagation()}>
        <WindowHead title="Visual" onClose={onClose} closeLabel="Fechar" />
        <div className="modal-card-body">
          <div className="visual-layout">
            <div className="visual-preview">
              <div className="outfit-preview-stage">
                <Retrato vocationId={vocationId} corNeon={draft.corNeon} tamanho={144} />
              </div>
              <strong>{character.name}</strong>
              <span className="meta">{character.vocation.name} · {nomeDaCor(draft.corNeon)}</span>
            </div>

            <div className="visual-controls">
              <h3>Cor neon</h3>
              <div className="visual-paleta" role="listbox" aria-label="Cor neon">
                {PALETA_NEON.map((cor, id) => (
                  <button
                    key={cor.nome}
                    type="button"
                    role="option"
                    aria-selected={draft.corNeon === id}
                    className={`visual-cor ${draft.corNeon === id ? 'on' : ''}`}
                    onClick={() => { setHint(''); setDraft((atual) => ({ ...atual, corNeon: id })); }}
                  >
                    <i style={corDaPaleta(id) ? { background: corDaPaleta(id)!, boxShadow: `0 0 8px ${corDaPaleta(id)}` } : undefined} className={id === 0 ? 'original' : ''} />
                    <span>{cor.nome}</span>
                  </button>
                ))}
              </div>

              <h3>Presets</h3>
              <div className="outfit-presets">
                {[0, 1, 2].map((slot) => {
                  const preset = character.appearancePresets?.[slot];
                  return (
                    <div key={slot} className="outfit-preset-row">
                      <strong>Preset {slot + 1}</strong>
                      <span className="meta">{preset ? nomeDaCor(preset.corNeon) : 'vazio'}</span>
                      <button type="button" className="btn" disabled={busy} onClick={() => void onPresetSave(slot)}>Salvar</button>
                      <button
                        type="button"
                        className="btn gold"
                        disabled={busy || !preset}
                        onClick={() => void onPresetLoad(slot).then((next) => { if (next) setDraft({ ...next, mount: 0 }); })}
                      >
                        Carregar
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="meta visual-dica">"Salvar" guarda o visual que já está aplicado.</p>
              {hint && <p className="outfit-hint">{hint}</p>}
            </div>
          </div>

          <div className="outfit-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
            <button
              type="button"
              className="btn gold"
              disabled={busy || !mudou}
              onClick={() => {
                void onApply({ ...draft, mount: 0 }).catch((error: unknown) => {
                  setHint(error instanceof Error ? error.message : 'Falha ao aplicar o visual.');
                });
              }}
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
