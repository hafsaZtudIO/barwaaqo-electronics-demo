import assert from "node:assert/strict";
import test from "node:test";
import { queryOptions } from "../validation.js";

test("sales history query filters keep supported values and normalize user input", () => {
    const query = queryOptions.parse({ q: "  Receipt ABC  ", customer: "00000000-0000-4000-8000-000000000001",
        payment: "Credit", sale_status: "part-returned", sales_sort: "total-high", page_size: "100", page: "2" });
    assert.equal(query.q, "Receipt ABC");
    assert.equal(query.payment, "Credit");
    assert.equal(query.sale_status, "part-returned");
    assert.equal(query.sales_sort, "total-high");
    assert.equal(query.page_size, 100);
    assert.equal(query.page, 2);
    assert.equal(query.customer, "00000000-0000-4000-8000-000000000001");
});

test("unsupported sales query values cannot inject sorting or unbounded page sizes", () => {
    const query = queryOptions.parse({ page_size: "2500", sales_sort: "total_minor; drop table shop.sales", payment: "Made up",
        sale_status: "Cancelled", customer: "not-a-uuid", from: "2026-02-30", page: "-1" });
    for (const key of ["page_size", "sales_sort", "payment", "sale_status", "customer", "from"])
        assert.equal(query[key], undefined);
    assert.equal(query.page, 1);
});
