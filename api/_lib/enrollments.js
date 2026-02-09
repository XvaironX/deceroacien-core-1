import { query } from './db.js';

export async function listUserEnrollments(user_id){
  const sql = `SELECT p.sku FROM enrollments e JOIN products p ON p.id = e.product_id WHERE e.user_id = $1 ORDER BY e.granted_at DESC`;
  const { rows } = await query(sql, [user_id]);
  return rows.map(r=>r.sku);
}

export async function grantEnrollment(user_id, product_sku, source='webhook_mp') {
  // Resolve product id
  const prodRes = await query('SELECT id FROM products WHERE sku = $1 AND is_active = true', [product_sku]);
  if (prodRes.rowCount === 0) throw new Error('invalid_product');
  const product_id = prodRes.rows[0].id;
  const sql = `INSERT INTO enrollments (user_id, product_id, source) VALUES ($1,$2,$3)
               ON CONFLICT (user_id, product_id) DO NOTHING RETURNING id`;
  await query(sql, [user_id, product_id, source]);
}
