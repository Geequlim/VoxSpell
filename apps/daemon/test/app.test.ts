import { describe, expect, it } from "vitest";

import { createStartupMessage } from "../src/app.js";

describe("createStartupMessage", () => {
	it("returns the daemon startup message", () => {
		expect(createStartupMessage()).toBe("VoxSpell daemon started");
	});
});
