// Base class
class Animal {
  speak() {
    return "Animal";
  }
}

// Derived class
class Dog extends Animal {
  constructor() {
    super();
    this.name = "Dog";
  }

  // Async arrow method calling super
  speakAsync = async () => {
    const base = super.speak(); // super inside async arrow
    return base + " → " + this.name;
  };
}

// Test
(async () => {
  const d = new Dog();
  console.log(await d.speakAsync()); // Should print: "Animal → Dog"
  console.log(d instanceof Dog); // true
  console.log(d instanceof Animal); // true
})();
