// web/lib/ses-lockdown-guard.ts
type GuardedGlobal = typeof globalThis & {
  __p30SymbolGuarded?: boolean;
};

type SymbolWithDisposables = typeof Symbol & {
  dispose?: symbol;
  asyncDispose?: symbol;
};

export function applyLockdownGuard(globalRef: GuardedGlobal = globalThis as GuardedGlobal): void {
  const getGlobalSymbol = (target: GuardedGlobal): SymbolWithDisposables | undefined => {
    const candidate = target.Symbol as SymbolWithDisposables | undefined;
    return typeof candidate === "function" ? candidate : undefined;
  };

  const cloneDescriptor = (
    descriptor: PropertyDescriptor,
    originalSymbol: SymbolWithDisposables,
  ): PropertyDescriptor => {
    if ("get" in descriptor || "set" in descriptor) {
      const getter = descriptor.get ? descriptor.get.bind(originalSymbol) : undefined;
      const setter = descriptor.set ? descriptor.set.bind(originalSymbol) : undefined;

      return {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable ?? false,
        get: getter,
        set: setter,
      };
    }

    if (typeof descriptor.value === "function") {
      const bound = (descriptor.value as Function).bind(originalSymbol);
      return {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable ?? false,
        writable: descriptor.writable ?? false,
        value: bound,
      };
    }

    return descriptor;
  };

  const createBlockedDescriptor = (
    key: PropertyKey,
    descriptor: PropertyDescriptor | undefined,
    removedKeys: Set<PropertyKey>,
    originalSymbol: SymbolWithDisposables,
  ): PropertyDescriptor => {
    const enumerable = descriptor?.enumerable ?? false;

    if (descriptor && ("get" in descriptor || "set" in descriptor)) {
      const getter = descriptor.get ? descriptor.get.bind(originalSymbol) : undefined;
      const setter = descriptor.set ? descriptor.set.bind(originalSymbol) : undefined;

      return {
        configurable: true,
        enumerable,
        get: () => (removedKeys.has(key) ? undefined : getter ? getter() : undefined),
        set: (value: unknown) => {
          removedKeys.delete(key);
          if (setter) {
            setter(value);
          }
        },
      };
    }

    let valueRef = descriptor ? descriptor.value : undefined;

    return {
      configurable: true,
      enumerable,
      get: () => (removedKeys.has(key) ? undefined : valueRef),
      set: (value: unknown) => {
        removedKeys.delete(key);
        valueRef = value;
      },
    };
  };

  if (!globalRef || globalRef.__p30SymbolGuarded) {
    return;
  }

  const originalSymbol = getGlobalSymbol(globalRef);
  if (!originalSymbol) {
    globalRef.__p30SymbolGuarded = true;
    return;
  }

  const blockedKeys = new Set<PropertyKey>(["dispose", "asyncDispose"]);
  if (originalSymbol.dispose) blockedKeys.add(originalSymbol.dispose);
  if (originalSymbol.asyncDispose) blockedKeys.add(originalSymbol.asyncDispose);

  const removedKeys = new Set<PropertyKey>();

  const clonedSymbol = function p30Symbol(description?: unknown) {
    return (originalSymbol as unknown as (description?: unknown) => symbol)(description);
  } as SymbolWithDisposables & { __p30ProxyGuard?: boolean };

  try {
    Reflect.defineProperty(clonedSymbol, "name", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: "Symbol",
    });
  } catch {
    // ignore inability to redefine the function name
  }

  try {
    Reflect.defineProperty(clonedSymbol, "length", {
      configurable: true,
      enumerable: false,
      writable: false,
      value: 0,
    });
  } catch {
    // ignore inability to redefine the function length
  }

  try {
    Reflect.defineProperty(clonedSymbol, "prototype", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: (originalSymbol as unknown as { prototype: unknown }).prototype,
    });
  } catch {
    // ignore inability to mirror the prototype
  }

  for (const key of Reflect.ownKeys(originalSymbol)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(originalSymbol, key);
    if (!descriptor) continue;

    if (blockedKeys.has(key)) {
      try {
        Reflect.defineProperty(
          clonedSymbol,
          key,
          createBlockedDescriptor(key, descriptor, removedKeys, originalSymbol),
        );
      } catch {
        // ignore descriptor replication errors
      }
      continue;
    }

    try {
      Reflect.defineProperty(clonedSymbol, key, cloneDescriptor(descriptor, originalSymbol));
    } catch {
      // ignore inability to clone non-critical descriptors
    }
  }

  Object.defineProperty(clonedSymbol, "__p30ProxyGuard", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });

  try {
    Object.defineProperty(clonedSymbol, Symbol.toStringTag, {
      configurable: true,
      enumerable: false,
      writable: false,
      value: "Symbol",
    });
  } catch {
    // ignore inability to define @@toStringTag
  }

  const originalDelete = (key: PropertyKey) => {
    if (!blockedKeys.has(key)) return false;
    removedKeys.add(key);
    return true;
  };

  const guardedSymbol = new Proxy(clonedSymbol, {
    apply(_target, thisArg, argArray) {
      return Reflect.apply(originalSymbol, thisArg, argArray);
    },
    deleteProperty(target, prop) {
      if (originalDelete(prop)) {
        try {
          Reflect.deleteProperty(target, prop);
        } catch {
          // ignore inability to delete blocked key replica
        }
        return true;
      }
      try {
        return Reflect.deleteProperty(originalSymbol, prop);
      } catch {
        return false;
      }
    },
    get(target, prop, receiver) {
      if (prop === "__p30ProxyGuard") return true;
      if (blockedKeys.has(prop)) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
        if (!descriptor) return undefined;
        if ("get" in descriptor && descriptor.get) {
          return descriptor.get.call(receiver);
        }
        return descriptor.value;
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        try {
          return value.bind(originalSymbol);
        } catch {
          return value;
        }
      }
      return value;
    },
    has(target, prop) {
      if (blockedKeys.has(prop)) {
        return !removedKeys.has(prop) && Reflect.has(target, prop);
      }
      return Reflect.has(target, prop) || Reflect.has(originalSymbol, prop);
    },
    ownKeys(target) {
      const result: Array<string | symbol> = [];
      for (const key of Reflect.ownKeys(target)) {
        if (blockedKeys.has(key) && removedKeys.has(key)) {
          continue;
        }
        if (typeof key === "string" || typeof key === "symbol") {
          if (!result.includes(key)) {
            result.push(key);
          }
        }
      }
      return result;
    },
    getOwnPropertyDescriptor(target, prop) {
      if (blockedKeys.has(prop)) {
        if (removedKeys.has(prop)) {
          return undefined;
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
        if (descriptor) descriptor.configurable = true;
        return descriptor;
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    set(target, prop, value, receiver) {
      if (blockedKeys.has(prop)) {
        removedKeys.delete(prop);
      }
      return Reflect.set(target, prop, value, receiver);
    },
    defineProperty(target, prop, attributes) {
      if (blockedKeys.has(prop)) {
        removedKeys.delete(prop);
        const descriptor = createBlockedDescriptor(
          prop,
          attributes,
          removedKeys,
          originalSymbol,
        );
        return Reflect.defineProperty(target, prop, descriptor);
      }
      return Reflect.defineProperty(target, prop, attributes);
    },
  });

  try {
    Object.defineProperty(globalRef, "Symbol", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: guardedSymbol,
    });
  } catch {
    (globalRef as Record<string, unknown>).Symbol = guardedSymbol;
  }

  const stub = function () {};
  try {
    Object.defineProperty(globalRef as Record<string, unknown>, "lockdown", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: stub,
    });
  } catch {
    (globalRef as Record<string, unknown>).lockdown = stub;
  }

  const sesNamespace = (globalRef as Record<string, unknown>).ses as
    | Record<string, unknown>
    | undefined;
  if (sesNamespace) {
    try {
      Object.defineProperty(sesNamespace, "lockdown", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: stub,
      });
    } catch {
      sesNamespace.lockdown = stub;
    }
  }

  if (typeof (globalRef as Record<string, unknown>).harden !== "function") {
    (globalRef as Record<string, unknown>).harden = (value: unknown) => value;
  }

  globalRef.__p30SymbolGuarded = true;
}

export const LOCKDOWN_GUARD_SNIPPET = `;(${applyLockdownGuard.toString()})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : undefined);`;

