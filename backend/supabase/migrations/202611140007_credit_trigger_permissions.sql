begin;

-- Deferred checks run after the checkout function returns, under the caller's role.
-- Keep the shop schema private and let this trigger read only through its owner.
alter function shop.require_credit_customer() security definer;
revoke execute on function shop.require_credit_customer() from public, anon, authenticated, service_role;

commit;
