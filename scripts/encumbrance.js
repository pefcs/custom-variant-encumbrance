Hooks.once('init', () => {
  console.log("Initializing Custom Encumbrance Module");

  // Register module settings for encumbrance thresholds and counting unequipped items
  game.settings.register("custom-variant-encumbrance", "encumberedThresholdImperial", {
    name: "Encumbered Threshold (lbs)",
    hint: "The weight threshold for becoming encumbered in pounds.",
    scope: "world",
    config: true,
    type: Number,
    default: 5
  });

  game.settings.register("custom-variant-encumbrance", "heavilyEncumberedThresholdImperial", {
    name: "Heavily Encumbered Threshold (lbs)",
    hint: "The weight threshold for becoming heavily encumbered in pounds.",
    scope: "world",
    config: true,
    type: Number,
    default: 10
  });

  game.settings.register("custom-variant-encumbrance", "maximumThresholdImperial", {
    name: "Maximum Threshold (lbs)",
    hint: "The maximum weight a character can carry in pounds.",
    scope: "world",
    config: true,
    type: Number,
    default: 15
  });

  game.settings.register("custom-variant-encumbrance", "countUnequippedItems", {
    name: "Count Unequipped Items",
    hint: "Whether to count the weight of unequipped items towards encumbrance.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Update global encumbrance thresholds on init with the actual configuration
  updateGlobalEncumbranceThresholds();

  // Register a wrapper for the prepareDerivedData function to customize encumbrance calculation
  libWrapper.register("custom-variant-encumbrance", "CONFIG.Actor.documentClass.prototype.prepareDerivedData", function (wrapped, ...args) {
    const countUnequippedItems = game.settings.get("custom-variant-encumbrance", "countUnequippedItems");

    // Call the original function first
    wrapped.apply(this, args);

    // Inject custom encumbrance calculation if unequipped items are not counted
    if (!countUnequippedItems) {
      if (this.type === "group") return;
	    
      this.system.attributes.encumbrance = this.system.attributes.encumbrance || {};

      let totalWeight = 0;

      this.items.forEach(item => {
        const itemWeight = getItemWeight(item);
        const itemQuantity = item.system.quantity || 0;
        const equipped = item.system.equipped || false;
        const inContainer = item.system.container != null;
	let containerEquipped = false;
	let weightlessContents = false;	      
        // Checking if item is in a container
        if (inContainer) {
          const container = this.items.get(item.system.container);
          // Checking if the container is equipped and if not "Bag of Holding" type		
          if (container) {
            containerEquipped = container.system.equipped;
            if (container.system.properties instanceof Set) {
	      weightlessContents = container.system.properties.has('weightlessContents');
            }
	  }
        }
	      
        if (equipped || (inContainer && containerEquipped && !weightlessContents)) {
          totalWeight += itemWeight * itemQuantity;
        }
      });

      this.system.attributes.encumbrance.value = totalWeight.toFixed(1);

      // Update encumbrance thresholds and percentage
      const config = CONFIG.DND5E.encumbrance;
      // Checking Powerful Build feat
      const hasPowerfulBuild = this.system.parent.flags?.dnd5e?.powerfulBuild || false;
      const sizeConfig = CONFIG.DND5E.actorSizes[this.system.traits.size] || {};
      let sizeMod = sizeConfig.capacityMultiplier || 1;
      // Increase size if has Powerful Build
      if (hasPowerfulBuild) {
	sizeMod += 1;
      }
      const maxWeight = sizeMod * 15 * (this.system.abilities.str.value || 10);

      this.system.attributes.encumbrance.max = maxWeight;
      this.system.attributes.encumbrance.pct = Math.min(100, Math.max(0, (totalWeight / maxWeight) * 100));
      this.system.attributes.encumbrance.encumbered = totalWeight > (game.settings.get("custom-variant-encumbrance", "encumberedThresholdImperial") * sizeMod);
      this.system.attributes.encumbrance.heavilyEncumbered = totalWeight > (game.settings.get("custom-variant-encumbrance", "heavilyEncumberedThresholdImperial") * sizeMod);
      this.system.attributes.encumbrance.maximum = totalWeight > (game.settings.get("custom-variant-encumbrance", "maximumThresholdImperial") * sizeMod);

      // Trigger a re-render of the character sheet to update the encumbrance UI
      if (this.sheet.rendered) {
        this.sheet.render(false);
      }
    }

    return;
  }, "WRAPPER");  
});

Hooks.once('ready', () => {
  // Update global encumbrance thresholds and all actors' encumbrance on ready
  updateGlobalEncumbranceThresholds();
  updateAllActorsEncumbrance();
});

/**
 * Extract the weight from an item safely.
 * @param {Object} item - The item to extract the weight from.
 * @returns {number} - The weight of the item.
 */
function getItemWeight(item) {
  if (typeof item.system.weight === 'number') {
    return item.system.weight;
  }
  if (typeof item.system.weight === 'object' && item.system.weight.value !== undefined) {
    return item.system.weight.value;
  }
  return 0;
}

// Listen for changes to module settings and update accordingly
Hooks.on("updateSetting", (setting) => {
  if (setting.key.startsWith("custom-variant-encumbrance.")) {
    // Ask the user if they want to reload the page
    new Dialog({
      title: "Reload Required",
      content: "<p>Changes to the encumbrance settings require a reload to take effect. Do you want to reload now?</p>",
      buttons: {
        yes: {
          icon: '<i class="fas fa-check"></i>',
          label: "Yes",
          callback: () => {
            location.reload();
          }
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "No"
        }
      },
      default: "yes"
    }).render(true);
  }
});

// Listen for actor updates and recalculate encumbrance if necessary
Hooks.on("updateActor", (actor, data, options, userId) => {
  if (actor.type !== "character") return;
  updateGlobalEncumbranceThresholds();
  updateActorEncumbrance(actor);
});

// Listen for settings configuration rendering and update encumbrance accordingly
Hooks.on("renderSettingsConfig", (app, html, data) => {
  updateGlobalEncumbranceThresholds();
  updateAllActorsEncumbrance();
});

/**
 * Update the encumbrance of a specific actor.
 * @param {Object} actor - The actor to update encumbrance for.
 */
function updateActorEncumbrance(actor) {
  let encumberedThresholdImperial = game.settings.get("custom-variant-encumbrance", "encumberedThresholdImperial");
  let heavilyEncumberedThresholdImperial = game.settings.get("custom-variant-encumbrance", "heavilyEncumberedThresholdImperial");
  let maximumThresholdImperial = game.settings.get("custom-variant-encumbrance", "maximumThresholdImperial");
  let countUnequippedItems = game.settings.get("custom-variant-encumbrance", "countUnequippedItems");

  let totalWeight = actor.items.reduce((acc, item) => {
    const itemWeight = getItemWeight(item);
    const itemQuantity = item.system.quantity || 0;
    const inContainer = item.system.container != null;
    let containerEquipped = false;
    let weightlessContents = false;
    // Checking if item is in a container
    if (inContainer) {
      const container = actor.items.get(item.system.container);
      // Checking if the container is equipped and if not "Bag of Holding" type
      if (container) {
        containerEquipped = container.system.equipped;
        if (container.system.properties instanceof Set) {
	  weightlessContents = container.system.properties.has('weightlessContents');
        }
      }
    }
	  
    if (item.system.equipped || countUnequippedItems || (inContainer && containerEquipped && !weightlessContents)) {
      return acc + (itemWeight * itemQuantity);
    }
    return acc;
  }, 0);

  const encumbrance = actor.system.attributes.encumbrance;
  const variant = game.settings.get("dnd5e", "encumbrance") === "variant";
  const statuses = [];

  if (totalWeight > maximumThresholdImperial) statuses.push("exceedingCarryingCapacity");
  if (totalWeight > heavilyEncumberedThresholdImperial && variant) statuses.push("heavilyEncumbered");
  if (totalWeight > encumberedThresholdImperial && variant) statuses.push("encumbered");

  actor.update({
    "system.attributes.encumbrance.value": totalWeight.toFixed(1),
    "system.attributes.encumbrance.statuses": statuses
  });

  // Trigger a re-render of the character sheet to update the encumbrance UI
  if (actor.sheet.rendered) {
    actor.sheet.render(false);
  }
}

/**
 * Update the encumbrance for all character actors.
 */
function updateAllActorsEncumbrance() {
  game.actors.filter(actor => actor.type === "character").forEach(actor => {
    updateActorEncumbrance(actor);
  });
}

/**
 * Update the global encumbrance thresholds based on module settings.
 */
function updateGlobalEncumbranceThresholds() {
  let encumberedThresholdImperial = game.settings.get("custom-variant-encumbrance", "encumberedThresholdImperial");
  let heavilyEncumberedThresholdImperial = game.settings.get("custom-variant-encumbrance", "heavilyEncumberedThresholdImperial");
  let maximumThresholdImperial = game.settings.get("custom-variant-encumbrance", "maximumThresholdImperial");

  let encumberedThresholdMetric = (encumberedThresholdImperial / 2.20462).toFixed(2);
  let heavilyEncumberedThresholdMetric = (heavilyEncumberedThresholdImperial / 2.20462).toFixed(2);
  let maximumThresholdMetric = (maximumThresholdImperial / 2.20462).toFixed(2);

  const encumbranceConfig = CONFIG.DND5E?.encumbrance?.threshold;
  
  if (encumbranceConfig) {
    encumbranceConfig.encumbered.imperial = encumberedThresholdImperial;
    encumbranceConfig.encumbered.metric = encumberedThresholdMetric;

    encumbranceConfig.heavilyEncumbered.imperial = heavilyEncumberedThresholdImperial;
    encumbranceConfig.heavilyEncumbered.metric = heavilyEncumberedThresholdMetric;

    encumbranceConfig.maximum.imperial = maximumThresholdImperial;
    encumbranceConfig.maximum.metric = maximumThresholdMetric;

    console.log("Encumbrance thresholds updated successfully.");
  } else {
    console.warn("Unable to access encumbrance thresholds. Make sure the dnd5e system is properly loaded.");
  }
}
