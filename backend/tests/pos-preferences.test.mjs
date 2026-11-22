import assert from "node:assert/strict";
import test from "node:test";
import { defaultRegisterPreferences, parseRegisterPreferences } from "../../frontend/components/pos-preferences.js";

test("register display settings accept known fields and discard invalid values", () => {
    assert.deepEqual(parseRegisterPreferences(null), defaultRegisterPreferences);
    assert.deepEqual(parseRegisterPreferences(JSON.stringify({ catalogView: "card", compactRows: true, showPhotos: false,
        showDetails: false, payment: "Credit", employeeId: "untrusted" })), {
        catalogView: "card", compactRows: true, showPhotos: false, showDetails: false,
    });
    assert.deepEqual(parseRegisterPreferences(JSON.stringify({ catalogView: "unknown", compactRows: "true", showPhotos: null })), defaultRegisterPreferences);
    for (const value of ["null", "[]", "123", "true"])
        assert.deepEqual(parseRegisterPreferences(value), defaultRegisterPreferences);
    assert.throws(() => parseRegisterPreferences("invalid json"));
    assert.deepEqual(defaultRegisterPreferences, { catalogView: "list", compactRows: false, showPhotos: true, showDetails: true });
});
