import { useId, useState, type ReactNode } from "react";

export function CollapsibleFeatureInfo({
    title,
    summary,
    children,
}: {
    title: string;
    summary: string;
    children: ReactNode;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const toggleId = useId();

    function onToggleInfo() {
        setIsOpen((prev) => !prev);
    }

    return (
        <s-section padding="none">
            <s-clickable
                id={`feature-toggle-${toggleId}`}
                onClick={onToggleInfo}
                padding="base"
                borderRadius="base"
            >
                <s-stack gap="small">
                    <s-heading>{title}</s-heading>
                    <s-text>{summary}</s-text>
                    {isOpen && (
                        <s-stack gap="small">
                            {children}
                        </s-stack>
                    )}
                    {isOpen ? 
                        <s-stack direction="inline" alignItems="center" gap="small">
                            <s-text color="subdued">Collapse</s-text>
                            <s-icon type="caret-up"/>
                        </s-stack>
                    : 
                        <s-stack direction="inline" alignItems="center" gap="small">
                            <s-text color="subdued">View more info</s-text>
                            <s-icon type="caret-down"/>
                        </s-stack>
                    }
                </s-stack>
            </s-clickable>
        </s-section>
    );
}