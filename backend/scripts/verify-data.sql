\set ON_ERROR_STOP on
begin isolation level repeatable read read only;

-- All result sets should be empty.
select p.id, p.sku, p.quantity, coalesce(sum(m.delta), 0) as ledger_quantity
from shop.products p left join shop.stock_movements m on m.product_id = p.id
group by p.id
having p.quantity <> coalesce(sum(m.delta), 0);

select s.id, s.total_minor, s.discount_minor, coalesce(sum(i.quantity * i.unit_minor::bigint), 0) as item_total_minor
from shop.sales s left join shop.sale_items i on i.sale_id = s.id
group by s.id
having count(i.product_id) = 0 or s.total_minor + s.discount_minor <> coalesce(sum(i.quantity * i.unit_minor::bigint), 0);

select i.sale_id, i.product_id, i.quantity, m.delta, m.employee_id
from shop.sale_items i join shop.sales s on s.id = i.sale_id
left join shop.stock_movements m on m.sale_id = i.sale_id and m.product_id = i.product_id
where m.id is null or m.delta <> -i.quantity or m.employee_id <> s.employee_id;

select i.sale_id, i.product_id, i.quantity, sum(r.quantity) as returned_quantity
from shop.sale_items i join shop.sale_return_items r using (sale_id, product_id)
group by i.sale_id, i.product_id
having sum(r.quantity) > i.quantity;

select r.id, r.refund_minor, r.credit_minor, sum(i.amount_minor) as returned_minor
from shop.sale_returns r left join shop.sale_return_items i on i.return_id = r.id
group by r.id
having count(i.product_id) = 0 or r.refund_minor + r.credit_minor <> sum(i.amount_minor);

select i.return_id, i.product_id, i.quantity, m.delta
from shop.sale_return_items i join shop.sale_returns r on r.id = i.return_id
left join shop.stock_movements m on m.return_id = i.return_id and m.product_id = i.product_id
where (i.restocked and (m.id is null or m.delta <> i.quantity or m.employee_id <> r.employee_id))
  or (not i.restocked and m.id is not null);

select p.id, p.total_minor, coalesce(sum(i.quantity * i.cost_minor::bigint),0) as item_total_minor
from shop.purchases p left join shop.purchase_items i on i.purchase_id = p.id
group by p.id
having count(i.product_id) = 0 or p.total_minor <> coalesce(sum(i.quantity * i.cost_minor::bigint),0);

select id, total_minor, paid_minor, status from shop.purchase_details
where paid_minor > total_minor or (status = 'cancelled' and paid_minor <> 0);

select i.purchase_id, i.product_id, p.status, m.delta
from shop.purchase_items i join shop.purchases p on p.id = i.purchase_id
left join shop.stock_movements m on m.purchase_id = i.purchase_id and m.product_id = i.product_id
where (p.status = 'received' and (m.id is null or m.delta <> i.quantity or m.cost_minor <> i.cost_minor
  or m.supplier_id <> p.supplier_id or m.occurred_on <> p.received_on))
  or (p.status <> 'received' and m.id is not null);

commit;
