class GameCharacter {
  constructor(name, hp) {
    this.name = name;
    this.hp = hp;
    this.inventory = new GameCharacter.Inventory(this);
    this.ai = new GameCharacter.AI(this);
  }

  attack(target) {
    console.log(`${this.name} attacks ${target.name}!`);
    target.hp -= 10;
    console.log(`${target.name}'s HP is now ${target.hp}`);
  }

  heal(amount) {
    this.hp += amount;
    console.log(`${this.name} heals for ${amount} HP. Current HP: ${this.hp}`);
  }

  static Inventory = class {
    constructor(character) {
      this.character = character;
      this.items = [];
    }

    add(item) {
      this.items.push(item);
      console.log(`${this.character.name} picks up ${item}.`);
    }

    use(item) {
      const idx = this.items.indexOf(item);
      if (idx === -1) {
        console.log(`${item} is not in inventory!`);
        return;
      }
      this.items.splice(idx, 1);
      console.log(`${this.character.name} uses ${item}.`);
      if (item === "potion") this.character.heal(20);
    }
  };

  static AI = class {
    constructor(character) {
      this.character = character;
    }

    decide(target) {
      if (this.character.hp < 30) {
        console.log(`AI: ${this.character.name} decides to heal!`);
        this.character.heal(15);
      } else {
        console.log(`AI: ${this.character.name} decides to attack!`);
        this.character.attack(target);
      }
    }
  };
}

// --- Test run ---
const hero = new GameCharacter("Seuriin", 50);
const monster = new GameCharacter("Goblin", 40);

hero.inventory.add("potion");
hero.inventory.use("potion");

monster.ai.decide(hero);
hero.ai.decide(monster);
