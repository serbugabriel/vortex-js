class Animal {
  async speak() {
    return "Animal";
  }
}

class Dog extends Animal {
  async speak() {
    const callSuper = async () => {
      const base = await super.speak();
      return base + " → Dog";
    };

    return await callSuper();
  }
}

(async () => {
  const d = new Dog();

  console.log(await d.speak());
  console.log(await Animal.prototype.speak.call(d));
  console.log(d instanceof Dog);
  console.log(d instanceof Animal);
})();
