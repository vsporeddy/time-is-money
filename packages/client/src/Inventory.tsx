import type { ItemInstance, ItemTemplate, Player, ScoreBreakdown } from 'shared';
import { getHiddenTrait, getMaterialValueMultiplier, getRarityValueMultiplier, getSpecialModifierValueMultiplier, getTemplate, getTraitDefinition, TRAIT_DEFINITIONS } from 'shared';
import { SpriteIcon } from './SpriteIcon';
import { getGlowFilter, getGlowIntensity, getItemGlowCategory, getTraitLabelColor } from './itemVisuals';
import { usePanelDrag } from './usePanelDrag';

interface InventoryProps {
  player: Player;
  items: Record<string, ItemInstance>;
  score?: ScoreBreakdown;
  side: 'left' | 'right';
  showValue?: boolean;
  onClose?: () => void;
  onUseItem?: (itemId: string) => void; // present only for the viewer's own inventory
  roundPhase?: 'preBid' | 'bidding' | null; // gates weapon effects tied to a round phase
  panelKey?: string; // identity for the remembered drag position; defaults to the side
  cascadeIndex?: number; // stagger for panels opened on top of each other
}

// Each additional panel opens down-and-left of the one before it so a stack of
// open inventories doesn't hide itself.
const CASCADE_STEP = 28;

function isEffectUsableNow(template: ItemTemplate | undefined, roundPhase: 'preBid' | 'bidding' | null | undefined): boolean {
  if (!template) return false;
  if (template.effectType === 'copyItem') return true; // Mirror of Desire: usable anytime
  if (!template.weapon) return false;
  if (template.weapon.phase === 'anytime') return true; // Crossbow: usable anytime
  return template.weapon.phase === roundPhase;
}

const INVENTORY_SIZE = 12;

interface DisplayAttribute {
  label: string;
  traitId?: string;
  effect?: boolean;
}

type SetBonusColor = 'gray' | 'bronze' | 'silver' | 'gold';

interface SetBonusTier {
  count: number;
  bonus: number;
  multiplier?: number;
  bonusPerMatchingItem?: number;
  matchingItemMultiplier?: number;
  strongestMatchingItemMultiplier?: number;
}

interface TraitProgress {
  id: string;
  name: string;
  count: number;
  target?: number;
  color: SetBonusColor;
  tiers: SetBonusTier[];
  noSetBonus?: boolean;
}

interface BreakdownLine {
  text: string;
  color?: SetBonusColor;
  className?: string;
}

function setBonusColor(tierCount: number, reachedTierIndex: number): SetBonusColor {
  if (reachedTierIndex < 0) return 'gray';
  if (tierCount === 1) return 'silver';
  if (tierCount === 2) return reachedTierIndex === 0 ? 'bronze' : 'silver';
  return reachedTierIndex === 0 ? 'bronze' : reachedTierIndex === 1 ? 'silver' : 'gold';
}

function setBonusText(traitId: string, tier: SetBonusTier): string {
  if (traitId === 'cursed' && tier.multiplier) return 'Change modifier to 1.25x';
  if (tier.bonusPerMatchingItem) return `ALL ${traitId === 'musical' ? 'Musical' : traitId} +$${tier.bonusPerMatchingItem}`;
  if (tier.matchingItemMultiplier) return `${traitId === 'aquatic' ? 'Aquatic items' : traitId} ×${tier.matchingItemMultiplier}`;
  if (tier.strongestMatchingItemMultiplier) return `Most Valuable Armor ×${tier.strongestMatchingItemMultiplier}`;
  return tier.multiplier ? `×${tier.multiplier}` : `+$${tier.bonus}`;
}

function breakdownTraitText(traitId: string, count: number, bonus: number, multiplier?: number): string {
  const name = getTraitDefinition(traitId)?.name ?? traitId;
  if (traitId === 'musical') return `${name} ${count}: +$${bonus}`;
  if (traitId === 'aquatic') return `${name} ${count}: Aquatic items ×${multiplier}`;
  if (traitId === 'armor') return `${name} ${count}: Most Valuable Armor ×${multiplier}`;
  return `${name} ${count}: ${multiplier ? `×${multiplier}` : `+$${bonus}`}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function itemAttributes(item: ItemInstance): DisplayAttribute[] {
  const template = getTemplate(item.templateId);
  const attributes: DisplayAttribute[] = [];

  for (const traitId of template?.traits ?? []) attributes.push({ label: getTraitDefinition(traitId)?.name ?? capitalize(traitId), traitId });
  if (item.investment) attributes.push({ label: 'Investment', effect: true });
  if (template?.scoreScaling === 'bargain') attributes.push({ label: 'Bargain' });
  if (item.fairTrade) attributes.push({ label: 'Fair Trade', effect: true });
  if (template?.effectType === 'timeRefund') attributes.push({ label: 'Time Refund' });
  if (item.solitaire) attributes.push({ label: 'Solitaire', effect: true });
  if (template?.effectType === 'revealBidding') attributes.push({ label: 'Scouts Bidders', effect: true });
  if (template?.effectType === 'chest') attributes.push({ label: 'Needs Key', effect: true });
  if (template?.effectType === 'key') attributes.push({ label: 'Opens Chests', effect: true });
  if (template?.effectType === 'refundOnLoss') attributes.push({ label: 'Refunds Losses', effect: true });
  if (template?.effectType === 'copyItem') attributes.push({ label: 'Copies an Item (click to use)', effect: true });
  if (template?.effectType === 'destroyLot') attributes.push({ label: 'Destroys the Lot', effect: true });
  if (template?.effectType === 'forceEnter') attributes.push({ label: template.weapon?.exclusive ? 'Forces a Duel' : 'Forces All to Bid', effect: true });
  if (template?.effectType === 'forceWithdraw') attributes.push({ label: template.weapon?.target === 'all' ? 'Clears the Field' : 'Forces a Withdrawal', effect: true });
  if (template?.effectType === 'destroyItem') attributes.push({ label: 'Destroys an Item', effect: true });
  if (template?.effectType === 'transformLot') attributes.push({ label: 'Transforms the Lot', effect: true });
  if (template?.effectType === 'stealTime') attributes.push({ label: 'Steals Time', effect: true });
  if (template?.effectType === 'weaponMultiplier') attributes.push({ label: 'Weapon Value x2', effect: true });
  if (item.usedActiveEffect) attributes.push({ label: 'Effect Used' });

  return attributes;
}

function modifierClass(value: string): string {
  return `modifier-${value.toLowerCase().replace(/\s+/g, '-')}`;
}

function specialModifierLabel(specialModifier: ItemInstance['specialModifier']): string {
  if (specialModifier === 'Cursed') return 'Cursed';
  if (specialModifier === 'Blessed') return 'Blessed ×1.1';
  return '';
}

function modifiedItemValue(item: ItemInstance): number {
  return Math.round(
    item.trueValue *
    getMaterialValueMultiplier(item.material) *
    getRarityValueMultiplier(item.rarity) *
    getSpecialModifierValueMultiplier(item.specialModifier)
  );
}

export function Inventory({
  player,
  items,
  score,
  side,
  showValue = true,
  onClose,
  onUseItem,
  roundPhase = null,
  panelKey,
  cascadeIndex = 0,
}: InventoryProps) {
  const { panelRef, panelStyle, headingProps, dragging } = usePanelDrag(panelKey ?? `inventory-${side}`, {
    x: (side === 'right' ? -1 : 1) * cascadeIndex * CASCADE_STEP,
    y: cascadeIndex * CASCADE_STEP,
  });
  const ownedItems = player.stash.map((id) => items[id]).filter((item): item is ItemInstance => Boolean(item));
  const stash = ownedItems.slice(0, INVENTORY_SIZE);
  const cursedSetActive = score?.traitBonuses.some((trait) => trait.traitId === 'cursed' && trait.multiplier === 1.25) ?? false;
  const traitProgress: TraitProgress[] = TRAIT_DEFINITIONS.map<TraitProgress | null>((trait) => {
    const count = trait.materialMatch
      ? ownedItems.filter((item) => item.specialModifier === trait.materialMatch).length
      : ownedItems.filter((item) => getTemplate(item.templateId)?.traits.includes(trait.id)).length;
    if (count === 0) return null;

    if (trait.noSetBonus) {
      return { id: trait.id, name: trait.name, count, color: 'gold', tiers: [], noSetBonus: true };
    }

    const reachedTierIndex = trait.tiers.reduce((highest, tier, index) => (count >= tier.count ? index : highest), -1);
    const target = trait.tiers.find((tier) => count < tier.count)?.count ?? trait.tiers[trait.tiers.length - 1].count;
    const color = setBonusColor(trait.tiers.length, reachedTierIndex);

    return { id: trait.id, name: trait.name, count, target, color, tiers: trait.tiers };
  }).filter((progress): progress is TraitProgress => progress !== null);
  const breakdown: BreakdownLine[] = score
    ? [
        { text: `Value: $${score.baseValue}` },
        score.hiddenTraitBonus !== 0 && { text: `Finds: ${score.hiddenTraitBonus >= 0 ? '+' : ''}$${score.hiddenTraitBonus}` },
        score.scoreScalingBonus !== 0 && { text: `Item effects: +$${score.scoreScalingBonus}`, className: 'item-effect-label' },
        score.solitaireBonus !== 0 && { text: `Solitaire bonuses: +$${score.solitaireBonus}` },
        score.hoarderBonus !== 0 && { text: `Hoarder bonus: +$${score.hoarderBonus}`, className: 'item-effect-label' },
        ...score.traitBonuses.map((trait) => {
          const definition = getTraitDefinition(trait.traitId);
          const reachedTierIndex = definition?.tiers.reduce((highest, tier, index) => (trait.count >= tier.count ? index : highest), -1) ?? -1;
          return {
            text: breakdownTraitText(trait.traitId, trait.count, trait.bonus, trait.multiplier),
            color: setBonusColor(definition?.tiers.length ?? 1, reachedTierIndex),
          };
        }),
      ].filter((line): line is BreakdownLine => Boolean(line))
    : [{ text: 'No revealed items yet.' }];

  return (
    <aside
      ref={panelRef}
      style={panelStyle}
      className={`inventory-panel inventory-panel-${side}${dragging ? ' inventory-panel-dragging' : ''}`}
      aria-label={`${player.name}'s inventory`}
    >
      <div {...headingProps}>
        <h2>{side === 'left' ? 'YOUR INVENTORY' : `${player.name.toUpperCase()}'S INVENTORY`}</h2>
        <div className="inventory-heading-actions">
          {showValue && (
            <div className="inventory-total" tabIndex={0}>
              <strong>${score?.total ?? 0}</strong>
              <div className="inventory-tooltip inventory-total-tooltip">
                <b>VALUE BREAKDOWN</b>
                {breakdown.map((line) => (
                  <span key={line.text} className={line.color ? `set-bonus-tier ${line.color}` : line.className}>{line.text}</span>
                ))}
              </div>
            </div>
          )}
          {onClose && <button type="button" className="inventory-close" aria-label="Minimize inventory" onClick={onClose}>×</button>}
        </div>
      </div>
      <div className="inventory-grid">
        {Array.from({ length: INVENTORY_SIZE }, (_, index) => {
          const item = stash[index];
          const template = item ? getTemplate(item.templateId) : undefined;
          const hiddenTrait = item ? getHiddenTrait(item.hiddenTraitId) : undefined;
          const used = item?.usedActiveEffect === true;
          const usable = Boolean(item && onUseItem && !used && isEffectUsableNow(template, roundPhase));
          const slotClasses = ['inventory-slot', usable && 'inventory-slot-usable', used && 'inventory-slot-used'].filter(Boolean).join(' ');
          const glowFilter = item ? getGlowFilter(getItemGlowCategory(template), getGlowIntensity(item.material, item.rarity)) : undefined;
          return (
            <div className={slotClasses} key={item?.id ?? `empty-${index}`}>
              {item && (
                <>
                  {usable ? (
                    <button type="button" className="inventory-slot-use-button" onClick={() => onUseItem!(item.id)} aria-label={`Use ${template?.name ?? item.templateId}`}>
                      <SpriteIcon index={Number(item.visual.baseSpriteId)} scale={2} glowFilter={glowFilter} />
                    </button>
                  ) : (
                    <SpriteIcon index={Number(item.visual.baseSpriteId)} scale={2} glowFilter={glowFilter} />
                  )}
                  <div className="inventory-tooltip inventory-item-tooltip">
                    <b>{template?.name ?? item.templateId}</b>
                    {showValue && <span>True Value: ${modifiedItemValue(item)}</span>}
                    {!template?.flatValue && (
                      <>
                        <span>Modifiers:</span>
                        <ul className="inventory-detail-list">
                          <li className={`modifier ${modifierClass(item.material)}`}>{item.material} ×{getMaterialValueMultiplier(item.material).toFixed(1)}</li>
                          <li className={`modifier ${modifierClass(item.rarity)}`}>{item.rarity} ×{getRarityValueMultiplier(item.rarity).toFixed(1)}</li>
                          {item.specialModifier && (
                            <li className={`modifier ${modifierClass(item.specialModifier)}`}>
                              {item.specialModifier === 'Cursed' ? (cursedSetActive ? 'Cursed x1.25' : 'Cursed ×0.75') : specialModifierLabel(item.specialModifier)}
                            </li>
                          )}
                        </ul>
                      </>
                    )}
                    <span>Attributes:</span>
                    <ul className="inventory-detail-list">
                      {itemAttributes(item).map((attribute) => {
                        const traitColor = attribute.traitId ? getTraitLabelColor(attribute.traitId) : undefined;
                        return (
                          <li key={attribute.label}>
                            <span
                              className={!traitColor && attribute.traitId ? 'attribute-set-label' : attribute.effect ? 'item-effect-label' : undefined}
                              style={traitColor ? { color: traitColor } : undefined}
                            >
                              {attribute.label}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {hiddenTrait && (
                      <span className={`inventory-find ${hiddenTrait.id === 'flawed' ? 'find-flawed' : hiddenTrait.id === 'windfall' ? 'find-windfall' : ''}`}>
                        {hiddenTrait.name} {hiddenTrait.scoreBonus >= 0 ? '+$' : '-$'}{Math.abs(hiddenTrait.scoreBonus)}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      {traitProgress.length > 0 && (
        <div className="trait-progress" aria-label="Set bonus progress">
          {traitProgress.map((progress) => (
            <span key={progress.id} className={`trait-progress-bubble ${progress.color}`} tabIndex={0}>
              {progress.noSetBonus
                ? `${progress.id === 'weapon' ? 'Weapon' : 'Trinket'} ${progress.count}`
                : `${progress.name}: ${progress.count}/${progress.target}`}
              <span className="trait-progress-tooltip">
                <b>{progress.id === 'weapon' ? 'WEAPON' : progress.noSetBonus ? 'TRINKETS' : `${progress.name} SET BONUS`}</b>
                {progress.noSetBonus
                  ? progress.id === 'weapon'
                    ? <span>Weapons are powerful one-time use items that impact other players</span>
                    : <><span>Trinkets are valuable on their own.</span><span>They have no SET bonus.</span></>
                  : progress.tiers.map((tier, index) => (
                    <span key={tier.count} className={`set-bonus-tier ${setBonusColor(progress.tiers.length, index)}`}>
                      {tier.count}: {setBonusText(progress.id, tier)}
                    </span>
                  ))}
              </span>
            </span>
          ))}
        </div>
      )}
    </aside>
  );
}
