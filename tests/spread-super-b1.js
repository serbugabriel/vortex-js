class BaseService {
  constructor(config = {}) {
    this.config = {
      timeout: 3000,
      headers: {
        "Content-Type": "application/json",
      },
      ...config,
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
    };
  }
}

class AuthService extends BaseService {
  constructor(config = {}) {
    super(config);

    this.config = {
      ...this.config,
      headers: {
        ...this.config.headers,
        Authorization: "Bearer token",
      },
    };
  }
}

const service = new AuthService({
  headers: { "X-App": "demo" },
});

console.log(service.config);
