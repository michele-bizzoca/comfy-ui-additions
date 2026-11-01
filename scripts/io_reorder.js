import { app } from "../../scripts/app.js";

// Adds Up/Down to the internal subgraph input AND output slot menus.
// Swap slot objects rather than recreating them, and update link indices.
const UP = "io-reorder-up";
const DOWN = "io-reorder-down";
const SETTING_ID = "ComfyUIAdditions.IOReorder.Enabled";
const enabled = () => app.ui.settings.getSettingValue(SETTING_ID) !== false;

function instancesOf(subgraph) {
  const root = subgraph.rootGraph || app.graph;
  const result = [];
  const seen = new Set();
  function visit(graph) {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    for (const node of graph.nodes || graph._nodes || []) {
      if (node.subgraph === subgraph) result.push(node);
      if (node.subgraph) visit(node.subgraph);
    }
  }
  visit(root);
  return result;
}

// The link store indexes target slots uniquely. Swapping two occupied targets
// with two individual assignments fails: the first target is still occupied.
// Temporarily park one target at the unused slot index `slotCount`, then
// rotate the other target into the vacancy. No link is disconnected or recreated.
function graphLinks(graph) {
  const links = graph?.links ?? graph?._links;
  if (links?.values) return [...links.values()];
  return links ? Object.values(links) : [];
}

function moveEndpoint(link, key, slot) {
  if (link[key] === slot) return true;
  link[key] = slot; // LLink setter updates the reactive link-store indexes.
  if (link[key] !== slot) {
    console.error(`[IO Reorder] Cannot move link ${link.id} to slot ${slot}`);
    return false;
  }
  return true;
}

function rotateLinks(links, key, index, next, slotCount) {
  const first = links.filter(link => link[key] === index);
  const second = links.filter(link => link[key] === next);
  const applied = [];
  const change = (link, to) => {
    const from = link[key];
    if (!moveEndpoint(link, key, to)) return false;
    applied.push({ link, from });
    return true;
  };
  // Parking at an unused index is safe for the indexed target side and
  // works for the origin side too. Different links can share an origin.
  const parkingNeeded = key === 'target_slot';
  const parked = parkingNeeded ? first : [];
  const moves = [
    ...parked.map(link => [link, slotCount]),
    ...second.map(link => [link, index]),
    ...first.map(link => [link, next]),
  ];
  // For origins, changing indices directly is safe; for targets we cannot
  // pass through an occupied target. Keep the parking phase separate.
  for (const [link, to] of moves) {
    if (link[key] === to) continue;
    if (!change(link, to)) {
      for (const { link: changed, from } of applied.reverse()) {
        moveEndpoint(changed, key, from);
      }
      return { ok: false, count: 0 };
    }
  }
  return { ok: true, count: first.length + second.length, undo: () => {
    // Inverse rotation uses the same vacant-slot technique.
    rotateLinks(links, key, next, index, slotCount);
  }};
}

function swapSubgraphSlots(ioNode, slot, delta, kind) {
  const sg = ioNode.subgraph;
  const isInput = kind === 'input';
  const definition = isInput ? sg?.inputs : sg?.outputs;
  const index = definition?.indexOf(slot) ?? -1;
  const next = index + delta;
  if (index < 0 || next < 0 || next >= definition.length) return;

  const instances = instancesOf(sg);
  const field = isInput ? 'inputs' : 'outputs';
  if (!instances.length || instances.some(node =>
    !Array.isArray(node[field]) || node[field].length !== definition.length ||
    (isInput && (node[field][index]?._subgraphSlot !== definition[index] ||
                 node[field][next]?._subgraphSlot !== definition[next]))
  )) {
    console.error(`[IO Reorder] Missing or inconsistent ${field} on host instance; aborted.`);
    return;
  }

  const innerKey = isInput ? 'origin_slot' : 'target_slot';
  const innerNodeKey = isInput ? 'origin_id' : 'target_id';
  const outerKey = isInput ? 'target_slot' : 'origin_slot';
  const outerNodeKey = isInput ? 'target_id' : 'origin_id';
  const innerLinks = graphLinks(sg).filter(link =>
    link[innerNodeKey] === ioNode.id && [index, next].includes(link[innerKey]));
  const outerGroups = instances.map(node => ({
    node,
    links: graphLinks(node.graph).filter(link =>
      link[outerNodeKey] === node.id && [index, next].includes(link[outerKey]))
  }));

  const operations = [
    { links: innerLinks, key: innerKey },
    ...outerGroups.map(({ links }) => ({ links, key: outerKey }))
  ];
  const completed = [];
  for (const { links, key } of operations) {
    const result = rotateLinks(links, key, index, next, definition.length);
    if (!result.ok) {
      for (const done of completed.reverse()) done.undo();
      console.error('[IO Reorder] Link permutation failed; original order retained.');
      return;
    }
    completed.push(result);
  }

  const oldOrder = definition.map(s => s.id);
  [definition[index], definition[next]] = [definition[next], definition[index]];
  for (const node of instances) {
    [node[field][index], node[field][next]] = [node[field][next], node[field][index]];
  }
  const externalCount = outerGroups.reduce((n, group) => n + group.links.length, 0);
  console.info(`[IO Reorder] ${kind} ${index} -> ${next}; ` +
    `${externalCount} external and ${innerLinks.length} internal links updated.`);
  for (const node of instances) {
    node.invalidatePromotedViews?.();
    node.setDirtyCanvas?.(true, true);
    node.graph?.change?.();
  }
  ioNode.arrange?.();
  sg.incrementVersion?.();
  sg.setDirtyCanvas?.(true, true);
  sg.events?.dispatch?.(`${field}-reordered`, {
    subgraph: sg, oldOrder, newOrder: definition.map(s => s.id)
  });
}

function kindOf(ioNode) {
  if (ioNode?.subgraph?.inputNode === ioNode) return "input";
  if (ioNode?.subgraph?.outputNode === ioNode) return "output";
  return null;
}

function install(ioNode) {
  if (!ioNode || !Array.isArray(ioNode.slots) || !kindOf(ioNode)) return;
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(ioNode));
  if (!proto || proto.__ioReorder) return;
  if (typeof proto._getSlotMenuOptions !== "function" ||
      typeof proto._onSlotMenuAction !== "function") {
    console.warn("[IO Reorder] Context menu API unavailable.");
    return;
  }
  const originalOptions = proto._getSlotMenuOptions;
  const originalAction = proto._onSlotMenuAction;
  proto._getSlotMenuOptions = function(slot) {
    const options = originalOptions.call(this, slot);
    const kind = kindOf(this);
    if (!enabled() || !kind || !this.slots?.includes(slot)) return options;
    const index = this.slots.indexOf(slot);
    if (index > 0) options.unshift({ content: "Up", value: UP });
    if (index < this.slots.length - 1) options.unshift({ content: "Down", value: DOWN });
    return options;
  };
  proto._onSlotMenuAction = function(item, slot, event) {
    if (enabled() && (item?.value === UP || item?.value === DOWN)) {
      const kind = kindOf(this);
      if (kind) swapSubgraphSlots(this, slot, item.value === UP ? -1 : 1, kind);
      return;
    }
    return originalAction.call(this, item, slot, event);
  };
  Object.defineProperty(proto, "__ioReorder", { value: true });
  console.info("[IO Reorder] Up/Down input/output menus installed.");
}

app.registerExtension({
  name: "comfy-ui-additions.io-reorder",
  setup() {
    app.ui.settings.addSetting({
      id: SETTING_ID,
      category: ["Comfy UI Additions"],
      name: "IO Reorder",
      type: "boolean",
      defaultValue: true,
      tooltip: "Show Up/Down commands on subgraph input/output slot menus.",
    });
    const scan = () => {
      const root = app.graph;
      for (const sg of root?.subgraphs?.values?.() || []) {
        install(sg.inputNode);
        install(sg.outputNode);
      }
      const current = app.canvas?.graph;
      if (current?.inputNode) install(current.inputNode);
      if (current?.outputNode) install(current.outputNode);
    };
    scan();
    const interval = setInterval(scan, 1200);
    window.addEventListener("beforeunload", () => clearInterval(interval), { once: true });
  }
});
