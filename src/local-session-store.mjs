// Local development only. Workers use the NOTION_DB binding instead.
export function memorySessionStore() {
  const rows=new Map(),now=() => Math.floor(Date.now()/1000);
  return {
    async put(id,type,value,expires) { rows.set(id,{type,value,expires}); },
    async get(id,type) { const row=rows.get(id); return row?.type===type && row.expires>now() ? {value:row.value} : null; },
    async take(id,type) { const row=rows.get(id); if(row?.type!==type) return null; rows.delete(id); return row; },
    async remove(id) { rows.delete(id); },
    async cleanup() { for(const [id,row] of rows) if(row.expires<=now()) rows.delete(id); }
  };
}
