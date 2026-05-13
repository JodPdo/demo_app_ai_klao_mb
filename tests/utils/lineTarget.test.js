const { extractLineTarget } = require("../../utils/lineTarget");

describe("extractLineTarget", () => {
  test("returns null for null input", () => {
    expect(extractLineTarget(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(extractLineTarget(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractLineTarget("")).toBeNull();
  });

  test("returns string as-is when there is no colon prefix", () => {
    expect(extractLineTarget("U1234567890abcdef")).toBe("U1234567890abcdef");
  });

  test("extracts group id from 'g:...' format", () => {
    expect(extractLineTarget("g:C1234567890abcdef")).toBe("C1234567890abcdef");
  });

  test("extracts room id from 'r:...' format", () => {
    expect(extractLineTarget("r:R123abc456")).toBe("R123abc456");
  });

  test("extracts user id from 'dm:...' format", () => {
    expect(extractLineTarget("dm:Uabcdef123456")).toBe("Uabcdef123456");
  });

  test("handles multiple colons — uses first one as separator", () => {
    expect(extractLineTarget("g:C123:extra")).toBe("C123:extra");
  });
});
