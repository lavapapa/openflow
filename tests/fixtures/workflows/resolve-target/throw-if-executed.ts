export const meta = {
  name: "throw-if-executed",
  description: "Should not be executed"
};

throw new Error("This code should not be executed during resolution");
