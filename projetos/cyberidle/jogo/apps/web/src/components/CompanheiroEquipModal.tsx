import type { CharacterView, EquippedItem } from '../api/types.js';
import { formatNumber, itemRarity } from '../format.js';
import { PAPERDOLL_SLOTS } from '../ui/paperdollSlots.js';
import { ItemSlot } from './ItemSlot.js';
import { WindowHead } from './WindowHead.js';

/**
 * Equipamento de um companheiro da party (Cyberidle): mostra o set dele e deixa organizar
 * com o ouro dele, o mesmo "Organizar" do personagem principal. Lab Hub, Claude (Opus 5.5).
 */
export function CompanheiroEquipModal({
  character,
  busy,
  onClose,
  onOrganizar,
}: {
  character: CharacterView;
  busy: boolean;
  onClose: () => void;
  onOrganizar: () => void;
}) {
  const vestidos = PAPERDOLL_SLOTS.filter((slot) => character.equipment[slot.id]).length;
  return (
    <div className="modal" onClick={onClose}>
      <div className="helper-card equip-companheiro" onClick={(event) => event.stopPropagation()}>
        <WindowHead title={`Equipamento · ${character.name}`} onClose={onClose} closeLabel="Fechar" />
        <div className="equip-companheiro-body">
          <div className="paperdoll">
            {PAPERDOLL_SLOTS.map((slot) => {
              const item = character.equipment[slot.id] as EquippedItem | undefined;
              return (
                <div key={slot.id} className={`paper-slot ${slot.area}`}>
                  <ItemSlot itemId={item?.id} label={item?.name} rarity={item ? itemRarity(item.id) : undefined} />
                </div>
              );
            })}
          </div>
          <div className="equip-companheiro-info">
            <div><span>Vocação</span><strong>{character.vocation.name} · lvl {character.level}</strong></div>
            <div><span>Itens vestidos</span><strong>{vestidos} / {PAPERDOLL_SLOTS.length}</strong></div>
            <div><span>Ouro dele</span><strong>{formatNumber(character.gold)} gp</strong></div>
            <button type="button" className="btn gold" disabled={busy} onClick={onOrganizar}>
              Organizar equipamento
            </button>
            <p className="party-sub">Compra e veste o melhor equipamento que couber no ouro dele.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
