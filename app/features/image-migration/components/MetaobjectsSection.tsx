import type { MetaobjectGroup } from "../types";
import { MetaobjectGroupView } from "./MetaobjectGroupView";

interface MetaobjectsSectionProps {
  metaobjectGroups: MetaobjectGroup[];
  openMetaobjectIds: Record<string, boolean>;
  onToggleMetaobjectGroup: (groupType: string) => void;
}

export function MetaobjectsSection({
  metaobjectGroups,
  openMetaobjectIds,
  onToggleMetaobjectGroup,
}: MetaobjectsSectionProps) {
  return (
    <s-section>
      <s-heading>Metaobjects ({metaobjectGroups.length} types)</s-heading>

      <s-stack direction="block" gap="base">
        {metaobjectGroups.map((group) => (
          <MetaobjectGroupView
            key={group.type}
            group={group}
            isOpen={openMetaobjectIds[group.type] ?? false}
            onToggle={() => onToggleMetaobjectGroup(group.type)}
          />
        ))}

        {metaobjectGroups.length === 0 && (
          <s-text color="subdued">
            <em>No metaobjects found</em>
          </s-text>
        )}
      </s-stack>
    </s-section>
  );
}
