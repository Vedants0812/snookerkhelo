import { useState } from 'react';
import { api, post, put, del, money } from '../api.js';
import { Modal, Field, Loading, Empty, useLoad, useAction } from '../ui.jsx';
import { useApp } from '../App.jsx';

export default function Products() {
  const admin = useApp().user.role === 'admin';
  const { data, error, reload } = useLoad(() => api('/products'), []);
  const [edit, setEdit] = useState(null);

  return (
    <>
      <div className="page-head">
        <div><h1>Snacks &amp; items</h1><p className="muted">Menu that can be added to a table bill or sold at the counter.</p></div>
        {admin && <button className="btn primary" onClick={() => setEdit({})}>+ Add item</button>}
      </div>
      {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>No items yet.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Item</th><th>Category</th><th className="num">Price</th><th className="num">Stock</th>{admin && <th />}</tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p._id}>
                  <td>{p.name}</td><td>{p.category}</td><td className="num">{money(p.price)}</td>
                  <td className={`num ${p.stock !== null && p.stock <= 5 ? 'bad' : ''}`}>{p.stock === null ? '—' : p.stock}</td>
                  {admin && <td className="num"><button className="btn sm" onClick={() => setEdit(p)}>Edit</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ProductForm item={edit} categories={[...new Set((data || []).map((p) => p.category))]} onClose={() => setEdit(null)} reload={reload} />}
    </>
  );
}

function ProductForm({ item, categories, onClose, reload }) {
  const [f, setF] = useState({ name: item.name || '', category: item.category || 'Snacks', price: item.price ?? '', stock: item.stock ?? '' });
  const [run, busy] = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { ...f, stock: f.stock === '' ? null : f.stock };
      if (item._id) await put(`/products/${item._id}`, body); else await post('/products', body);
      await reload(); onClose();
    }, 'Saved');
  };
  const remove = () => window.confirm(`Remove ${item.name} from the menu?`) && run(async () => { await del(`/products/${item._id}`); await reload(); onClose(); }, 'Removed');

  return (
    <Modal title={item._id ? 'Edit item' : 'Add item'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Name"><input className="input" required autoFocus value={f.name} onChange={set('name')} /></Field>
        <Field label="Category">
          <input className="input" list="cats" value={f.category} onChange={set('category')} />
          <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <div className="row gap">
          <Field label="Price (₹)"><input className="input" type="number" min="0" step="0.5" required value={f.price} onChange={set('price')} /></Field>
          <Field label="Stock" hint="Leave empty to not track stock"><input className="input" type="number" min="0" value={f.stock} onChange={set('stock')} /></Field>
        </div>
        <div className="modal-foot">
          {item._id && <button type="button" className="btn ghost danger-text" onClick={remove}>Remove</button>}
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
