type MatchHandler = (data: any) => void;

const handlers: MatchHandler[] = [];

export const addMatchHandler = (fn: MatchHandler) => {
  handlers.push(fn);
};

export const removeMatchHandler = (fn: MatchHandler) => {
  const i = handlers.indexOf(fn);
  if (i !== -1) handlers.splice(i, 1);
};

export const emitMatchData = (data: any) => {
  handlers.forEach((h) => h(data));
};
