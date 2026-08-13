import type { NeuraCoAgentModel, NeuraCoModelOption } from '../electron/ipc-contract';
import { FALLBACK_NEURACO_MODELS } from '../electron/model-utils';

export const fallbackModelOptions = (): NeuraCoModelOption[] => (
  FALLBACK_NEURACO_MODELS.map((model) => ({ ...model }))
);

export const isModelAvailable = (
  models: readonly NeuraCoModelOption[],
  model: NeuraCoAgentModel
): boolean => model === 'auto' || models.some((candidate) => candidate.id === model);

export default function ModelOptions({
  models,
  includeAuto = false,
  autoLabel = 'Automatique',
  currentValue
}: {
  models: readonly NeuraCoModelOption[];
  includeAuto?: boolean;
  autoLabel?: string;
  currentValue?: string;
}) {
  const groups = new Map<string, NeuraCoModelOption[]>();
  models.forEach((model) => {
    const values = groups.get(model.group) || [];
    values.push(model);
    groups.set(model.group, values);
  });
  const unavailableCurrent = currentValue
    && currentValue !== 'auto'
    && !models.some((model) => model.id === currentValue);

  return (
    <>
      {includeAuto && <option value="auto">{autoLabel}</option>}
      {unavailableCurrent && (
        <option value={currentValue} disabled>
          {currentValue} (indisponible)
        </option>
      )}
      {[...groups.entries()].map(([group, entries]) => (
        <optgroup key={group} label={group}>
          {entries.map((model) => (
            <option key={model.id} value={model.id}>
              {model.display_name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}
