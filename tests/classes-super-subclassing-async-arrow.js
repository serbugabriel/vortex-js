class BaseArray extends Array {
  async sumAsync() {
    const calc = () => this.reduce((a, b) => a + b, 0);
    return calc();
  }
}

class ExtendedArray extends BaseArray {
  async sumAsync() {
    const callSuper = async () => await super.sumAsync();
    return (await callSuper()) + 10;
  }
}

(async () => {
  const arr = new ExtendedArray(1, 2, 3);
  console.log(arr instanceof ExtendedArray); // true
  console.log(arr instanceof BaseArray); // true
  console.log(arr instanceof Array); // true
  console.log(await arr.sumAsync()); // 16
})();
