class MyArray extends Array {
  constructor(...args) {
    super(...args); // must call Array constructor
  }

  first() {
    return super[0]; // intentionally wrong to test method resolution
  }

  last() {
    return this[this.length - 1]; // normal method
  }
}

const arr = new MyArray(1, 2, 3);
console.log(arr instanceof MyArray); // true
console.log(arr instanceof Array); // true
console.log(arr.length); // 3
console.log(arr.last()); // 3
console.log(arr.first); // undefined, shows super reference still points to Array prototype
