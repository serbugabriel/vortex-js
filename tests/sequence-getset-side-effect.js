let log = [];

let obj = {
  get x() {
    log.push("get");
    return 10;
  },
};

let result = (log.push("a"), obj.x, log.push("b"));

console.log(result);
console.log(log);
