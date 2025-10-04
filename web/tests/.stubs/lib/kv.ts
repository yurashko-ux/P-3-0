export const kvRead = {
  listCampaigns: async () => [],
  getRaw: async (_key: string) => null,
  lrange: async (_key: string, _start: number, _stop: number) => [],
};

export const kvWrite = {
  lpush: async (_key: string, _value: string) => undefined,
  setRaw: async (_key: string, _value: string) => undefined,
};

export const campaignKeys = {
  INDEX_KEY: 'stub:index',
  ITEM_KEY: (id: string) => `stub:item:${id}`,
};
