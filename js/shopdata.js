const SHOP_DATA = {
  offers: [],
  sections: [],
  backdrop: null,
  _loaded: false,

  // 15 deals: reward:amount:price:currency:priority:stock
  ALL_DEALS: [
    { reward:'coins', amount:750,  price:10,  currency:'gems',  priority:1, stock:10 },
    { reward:'coins', amount:1000, price:12,  currency:'gems',  priority:1, stock:10 },
    { reward:'coins', amount:1250, price:15,  currency:'gems',  priority:2, stock:5  },
    { reward:'coins', amount:1500, price:17,  currency:'gems',  priority:2, stock:5  },
    { reward:'coins', amount:2500, price:22,  currency:'gems',  priority:3, stock:2  },
    { reward:'gems',  amount:3,    price:750,  currency:'coins', priority:2, stock:5  },
    { reward:'gems',  amount:5,    price:1000, currency:'coins', priority:2, stock:5  },
    { reward:'gems',  amount:7,    price:1200, currency:'coins', priority:3, stock:2  },
    { reward:'gems',  amount:10,   price:1500, currency:'coins', priority:3, stock:2  },
    { reward:'basic_crate', amount:1, price:3,  currency:'gems',  priority:1, stock:5  },
    { reward:'basic_crate', amount:2, price:5,  currency:'gems',  priority:2, stock:2  },
    { reward:'rare_crate',  amount:1, price:7,  currency:'gems',  priority:1, stock:5  },
    { reward:'rare_crate',  amount:2, price:12, currency:'gems',  priority:2, stock:2  },
    { reward:'basic_crate', amount:1, price:150, currency:'coins', priority:3, stock:1  },
    { reward:'rare_crate',  amount:1, price:500, currency:'coins', priority:3, stock:1  },
  ],

  // Free daily offer
  FREE_OFFER: { reward:'coins', amount:100, id:'daily_free' },

  init(){
    this._loadShopFile();
    if(!this._loaded || !this.offers.length){
      this._loadFromFile().catch(() => {}).then(loaded => {
        if(!loaded) this.refreshDaily();
      });
    }
  },

  async _loadFromFile(){
    try {
      const resp = await fetch('saves/shop.json');
      if(!resp.ok) return false;
      const data = await resp.json();
      if(data && data.offers && data.offers.length){
        this.offers = data.offers;
        this.sections = data.sections || [];
        this.backdrop = data.backdrop || null;
        this._loaded = true;
        this.saveShopFile();
        return true;
      }
    } catch(e){}
    return false;
  },

  _loadShopFile(){
    try {
      const raw = localStorage.getItem('tankparty_shop');
      if(raw){
        const d = JSON.parse(raw);
        if(d && d.offers) { this.offers = d.offers; this.sections = d.sections || []; this.backdrop = d.backdrop || null; this._loaded = true; }
      }
    } catch(e){}
  },

  saveShopFile(){
    localStorage.setItem('tankparty_shop', JSON.stringify({
      offers: this.offers,
      sections: this.sections,
      backdrop: this.backdrop,
    }));
  },

  refreshDaily(){
    const now = Date.now();
    const dayKey = Math.floor(now / 86400000);
    const lastKey = parseInt(localStorage.getItem('shop_daykey') || '0');
    if(dayKey !== lastKey){
      localStorage.setItem('shop_daykey', dayKey);
      localStorage.setItem('shop_free_claimed', '0');
    }
    this.offers = this._pickWeighted(this.ALL_DEALS, 6);
  },

  _pickWeighted(arr, count){
    const weights = { 1:3, 2:2, 3:1 };
    const pool = arr.map(d => ({ ...d, _weight: weights[d.priority] || 1 }));
    const result = [];
    for(let i = 0; i < count && pool.length; i++){
      const totalW = pool.reduce((s, x) => s + x._weight, 0);
      let r = Math.random() * totalW;
      let idx = 0;
      for(let j = 0; j < pool.length; j++){
        r -= pool[j]._weight;
        if(r <= 0){ idx = j; break; }
      }
      result.push(pool.splice(idx, 1)[0]);
    }
    return result;
  },

  getOffers(){ return this.offers; },

  isFreeClaimed(){
    return localStorage.getItem('shop_free_claimed') === '1';
  },

  claimFree(){
    if(this.isFreeClaimed()) return false;
    localStorage.setItem('shop_free_claimed', '1');
    const s = Menu.settings;
    s.coins = (s.coins || 0) + this.FREE_OFFER.amount;
    saveSettings(s);
    return true;
  },

  canAfford(offer){
    const s = Menu.settings;
    if(offer.currency === 'coins') return (s.coins || 0) >= offer.price;
    if(offer.currency === 'gems') return (s.gems || 0) >= offer.price;
    return false;
  },

  purchase(offer){
    const s = Menu.settings;
    if(!this.canAfford(offer)) return false;
    if(offer.currency === 'coins') s.coins = (s.coins || 0) - offer.price;
    else if(offer.currency === 'gems') s.gems = (s.gems || 0) - offer.price;
    if(offer.stock > 0) offer.stock--;
    // Crates coming soon — no reward given yet
    if(offer.reward === 'coins') s.coins = (s.coins || 0) + offer.amount;
    else if(offer.reward === 'gems') s.gems = (s.gems || 0) + offer.amount;
    // crates: no-op for now
    saveSettings(s);
    this.saveShopFile();
    return true;
  },
};
