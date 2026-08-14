# Visual quality contract

Apply this contract to every multi-group MapSpec and to every visual revision. It defines the production baseline for a readable complex map; it does not replace evidence or privacy rules in `mapspec-v1.schema.json`.

## Semantic vocabulary

- **Group:** a bounded business scope. Give every group a distinct tone and keep its title as a compact, centered top tab inside the group frame.
- **Node:** an actionable or meaningful system step. Keep nodes in their group's tone; show evidence state with both the node border treatment and a compact, legend-matched status dot in the card's upper-left corner.
- **Condition:** a labelled branch or prerequisite. Use the diamond condition marker and the condition label treatment; do not style it as a node.
- **Action relationship:** a cross-group transfer or effect. Use the directional marker and action label treatment.
- **Internal relationship:** a relation between nodes in the same group. Give its label a compact rounded frame so it is not mistaken for node text or a cross-group action.

## Layout and routing

- Model real business fan-out, fan-in, and cross-group relationships. Do not add empty layout-only groups or artificial stage containers merely to force a shape.
- Keep Mermaid's original node-to-node corridor as the route source. Simplify dense sampling points and round the continuous path; do not replace the full route with a global grid route.
- Connect each cross-group path to its true source and target nodes, with an arrow at the target. Split ports when one node has several incoming or outgoing paths.
- Use only local near-node detours when a connection would enter an unrelated node. Do not introduce long, visually noisy detours or gratuitous elbows.
- Tighten a group frame to the union of its own nodes. A relationship route must not inflate a group frame.

## Titles and relationship labels

- Center every group tab, keep it inside its frame, and leave clear space before the first node. Wrap a long title inside the tab; expand only that frame if its measured title needs more height.
- Place a condition or action label on a readable, exclusive segment of its own path whenever possible.
- Resolve collisions in this order: own-path open segment, minimal local displacement, then a short dotted leader back to the original path. A leader is evidence of displacement, not decoration; do not draw one for labels that remain naturally readable on their path.
- Avoid nodes, group titles, group frames, other labels, and unrelated paths. Do not permit labels to obscure content or leave the reader unable to identify the owning relationship.

## Interaction and feedback

- Hovering the path, its label, or its short leader must highlight the same relationship. Apply the flowing highlight to the path and the label, including internal relationships.
- Preserve each detail panel's scroll position by node. Keep the close control fixed while the detail content scrolls.
- Canvas dragging must not select graph text. Node selection should focus the selected node into the visible working area.
- `Fit` and the initial fit must reserve space for the fixed guide. It has three vertically stacked, labelled sections: Reading guide, Evidence status, and Controls. Keep the content inside each section on one row; at a narrow viewport preserve the three sections and use horizontal overflow instead of wrapping section content or hiding a section.

## Locale and fixed copy

- Set `meta.uiLocale` to `en` or `zh-CN` for every new production MapSpec. The maintained English and Chinese demos share the same graph structure and evidence data while localizing reader-facing copy; a Chinese delivery defaults to `zh-CN` unless the user requests English.
- Localize all fixed UI together: document language, graph region name, dependency-failure page, reading guide, relationship keys, evidence-state labels, controls guide, detail controls, and empty-state copy. Keep business text in its supplied language.
- Use the diamond icon as the condition marker. The adjacent legend text provides the localized semantic name; do not repeat a language-specific word inside every condition pill.

## Required visual acceptance

Inspect an actual generated complex graph before declaring visual acceptance. Check at least:

1. dense fan-in and fan-out ports, crossings, and route continuity;
2. label ownership, collision avoidance, and leader length;
3. group-frame size, title containment, and first-node clearance;
4. hover feedback for condition, action, and internal relationships;
5. localized copy in the reading guide, evidence status, controls guide, and detail panel, plus a visible upper-left status dot on every node that matches the legend; and
6. initial `Fit` and the Fit control with all three guide sections visible.

When a visual defect is found, reproduce it with a focused browser regression before changing the renderer. Regenerate both the representative Demo and the requested business artifact from the same renderer, then run the full test suite.
