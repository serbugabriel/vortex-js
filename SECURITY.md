# Security Policy

## 🛡️ Core Security Philosophy

VortexJS is designed based on the principle of **Security by Complexity** and **Virtualization**. Unlike traditional obfuscators that rely on lexical transformations (renaming variables), VortexJS relies on **semantical transformations**.

By compiling JavaScript into a custom bytecode format and executing it within a stackless virtual machine, we aim to maximize the **time and resource cost** required for reverse engineering, rather than claiming mathematical impossibility.

> [!IMPORTANT]
> **Obfuscation ≠ Encryption.**
> While VortexJS employs **Hyperwave Encryption** for string literals and **Polymorphic Dispatchers** for control flow, the client-side execution environment (the browser) ultimately possesses the keys required to run the code. VortexJS is designed to protect Intellectual Property (IP) and deter tampering, not to secure secrets (API keys, passwords) on the client side.

---

## 🔍 Threat Model & Defenses

VortexJS is engineered to defend against specific classes of reverse engineering attacks.

| Attack Vector | Vulnerability | VortexJS Defense Mechanism |
| :--- | :--- | :--- |
| **Static Analysis** | Analysis of source code without execution. | **Control Flow Flattening (CFG):** Linearizes logic into a single `while(true)` loop.<br>**Opaque Predicates:** Injects mathematically complex dead branches.<br>**Chaos Dispatcher:** Splits state variables (`S = K1^K2^K3`) to break taint analysis. |
| **Dynamic Analysis** | Debugging and stepping through code at runtime. | **Stackless Architecture:** Logic does not appear in the native call stack.<br>**Anti-Debug Predicates:** Measures execution timing to detect breakpoints/stepping.<br>**Honey Pots:** Deceptive code paths that corrupt memory if forced by a debugger. |
| **Automated Deobfuscators** | Tools that pattern-match generic obfuscators. | **Polymorphism:** The dispatcher structure (Switch/BST/Cluster) varies per build.<br>**Custom VM Instruction Set:** Logic is data-driven, not syntax-driven.<br>**Hyperwave Encryption:** N-dimensional geometric string transformation. |

---

## 🐛 Reporting a Vulnerability

We take the security of the **compiler itself** (e.g., code injection risks during compilation, insecure dependencies) seriously.

### Supported Versions

| Version | Supported |
| :--- | :--- |
| `3.x.x` | ✅ |
| `2.x.x` | ❌ |
| `1.x.x` | ❌ |
| `< 1.0` | ❌ |

### Reporting Process

If you discover a vulnerability in the VortexJS compiler or runtime:

1.  **Do NOT** open a public issue.
2.  Email the core maintainer at: `seuriin@gmail.com`.
3.  Include a Proof of Concept (PoC) demonstrating the vulnerability.

We aim to acknowledge reports as soon as we can.

---

## ⚠️ Known Limitations

VortexJS prioritizes **protection depth** over performance. Users should be aware of the following security/performance trade-offs:

1.  **Performance Overhead:** The Stackless Virtual Machine introduces a simplified instruction cycle overhead. This is unavoidable in virtualization-based obfuscation.
2.  **Browser DevTools:** While VortexJS obscures the *logic*, the *side effects* (Network requests, DOM manipulation) are always visible to the browser.
3.  **Malware Usage:** VortexJS contains safeguards to prevent its use in malicious contexts, but we explicitly disclaim responsibility for any code processed by this engine.

---

## 🛡️ Responsible Use

This tool is released for **Educational and IP Protection purposes only**.

*   **Do not** use VortexJS to hide malicious payloads.
*   **Do not** use VortexJS to bypass anti-virus or EDR solutions.
*   **Do** use VortexJS to protect proprietary algorithms, game logic, or sensitive client-side business rules.

---

## 📦 Dependency Security

VortexJS relies on a minimal set of dependencies (`@babel/parser`, `@babel/types`, `terser`, `esbuild`) to reduce surface area.
*   We utilize **Level 3 IR Optimization** to ensure that dead code introduced by dependencies is stripped before the virtualization phase.
*   Dependencies are audited via `npm audit` on every release cycle.
