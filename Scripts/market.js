'use strict';

const select = (selector) => document.querySelector(selector);
const escapeHTML = (text = '') => String(text).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const formatMoney = (value) => new Intl.NumberFormat('vi-VN').format(value) + ' ₫';
const params = new URLSearchParams(location.search);
const page = document.body.dataset.page;
const zoneById = (id) => marketZones.find((zone) => zone.id === id);
const activeZone = zoneById(params.get('zone'));
const zoneUrl = (id) => 'shop.html?zone=' + encodeURIComponent(id);
const listingUrl = (listing) => 'product.html?id=' + encodeURIComponent(listing.id);
const normalize = (text) => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('đ', 'd');
const fields = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  heart: '<path d="m12 20-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  account: '<circle cx="12" cy="8" r="3"/><path d="M5 20v-2a7 7 0 0 1 14 0v2Z"/>',
  logout: '<path d="M11 5H5v14h6m3-11 4 4-4 4m-5-4h9"/>',
  message: '<path d="M20 15a2 2 0 0 1-2 2H9l-5 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/>',
  listings: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.4"/><path d="m3 17 5-4 4 3 4-5 5 6"/>',
  room: '<path d="m3 11 9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 12l9 3 9-3"/>',
  parcel: '<path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4m-9 4v10"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${fields[name]}</svg>`;

let user = null;
let listings = [];
let mine = [];
let saved = [];
let providers = [];
let pendingSignup = false;
const maxPhotos = 5;
let draftPhotos = [];
const allListings = () => listings;
const listingById = (id) => listings.find((listing) => listing.id === id);
const viewHistoryKey = 'phuthinh.listing-views';
const viewHistoryAge = 30 * 24 * 60 * 60 * 1000;
function readViews() {
  try {
    const stored = JSON.parse(localStorage.getItem(viewHistoryKey) ?? '[]');
    if (!Array.isArray(stored)) return [];
    const now = Date.now();
    const recent = stored.filter((view) => view && typeof view.id === 'string'
      && Number.isFinite(view.at) && view.at <= now && view.at > now - viewHistoryAge).slice(0, 60);
    if (recent.length !== stored.length) localStorage.setItem(viewHistoryKey, JSON.stringify(recent));
    return recent;
  } catch {
    return [];
  }
}
function recordView(item) {
  if (!item || mine.includes(item.id)) return;
  const navigation = performance.getEntriesByType('navigation')[0]?.type;
  if (navigation === 'reload' || navigation === 'back_forward') return;
  try {
    const views = readViews();
    localStorage.setItem(viewHistoryKey, JSON.stringify([{ id: item.id, at: Date.now() }, ...views].slice(0, 60)));
  } catch {
    // Suggestions are optional when storage is unavailable.
  }
}
function recommendedListings(views) {
  const byId = new Map(listings.map((item) => [item.id, item]));
  const categoryKey = (item) => JSON.stringify([item.zone, item.category]);
  const categoryCounts = new Map();
  const itemCounts = new Map();
  for (const view of views) {
    const item = byId.get(view.id);
    if (!item || mine.includes(item.id)) continue;
    const key = categoryKey(item);
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
    itemCounts.set(item.id, (itemCounts.get(item.id) ?? 0) + 1);
  }
  return listings.map((item) => ({
    item, interest: categoryCounts.get(categoryKey(item)) ?? 0, views: itemCounts.get(item.id) ?? 0,
  })).filter(({ item, interest }) => interest >= 2 && item.quantity !== 0 && !mine.includes(item.id))
    .sort((a, b) => b.interest - a.interest || b.views - a.views)
    .slice(0, 4)
    .map(({ item }) => item);
}
async function api(path, method = 'GET', data) {
  const config = { method };
  if (data !== undefined) {
    config.headers = { 'Content-Type': 'application/json' };
    config.body = JSON.stringify(data);
  }
  let response;
  try {
    response = await fetch('/api/' + path, config);
  } catch {
    throw new Error(path === 'listings' && method === 'POST'
      ? 'Mất kết nối khi gửi tin. Kiểm tra Tin của tôi xem tin đã lưu chưa, rồi thử gửi lại khi máy chủ hoạt động.'
      : 'Không kết nối được với máy chủ. Kiểm tra kết nối rồi thử lại.');
  }
  if (response.status === 413) throw new Error('Ảnh hoặc nội dung quá lớn. Hãy chọn ảnh JPG, PNG hoặc WebP tối đa 1 MB.');
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Máy chủ chưa trả về dữ liệu của chợ. Kiểm tra địa chỉ trang rồi thử lại.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Chưa thực hiện được. Hãy thử lại.');
  return result;
}
let toastTimer;
function toast(message) {
  const status = select('#status');
  status.textContent = message;
  status.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { status.hidden = true; }, 3800);
}

function searchForm(zoneId = '', className = '') {
  return `<form action="shop.html" class="search ${className}" role="search">
    ${zoneId ? `<input type="hidden" name="zone" value="${zoneId}">` : ''}
    <input type="search" name="q" value="${escapeHTML(params.get('q') ?? '')}" placeholder="Bạn đang tìm gì ở chợ?" aria-label="Tìm tin trong chợ">
    <button aria-label="Tìm kiếm">${icon('search')}</button></form>`;
}

function header() {
  select('#header').innerHTML = `<div class="mainbar"><div class="wrap header-inner">
    <a class="brand" href="index.html" aria-label="Chợ Phú Thịnh, trang chủ">Chợ <strong>Phú Thịnh</strong></a>
    <nav class="zone-nav" aria-label="Các khu trong chợ">${marketZones.map((zone) => `<a href="${zoneUrl(zone.id)}"${activeZone?.id === zone.id ? ' aria-current="page"' : ''}>${zone.short}</a>`).join('')}</nav>
    ${searchForm(activeZone?.id, 'header-search')}
    <div class="tools"><a class="icon" href="wishlist.html" aria-label="Tin đã lưu">${icon('heart')}<span id="saved-count" class="badge"${saved.length ? '' : ' hidden'}>${saved.length}</span></a>
    <button type="button" class="icon" id="account-toggle" data-action="account" aria-label="Tài khoản"${user ? ' aria-expanded="false" aria-controls="account-menu"' : ''}>${icon('account')}</button>
    ${user ? accountMenu() : ''}
    <button type="button" class="icon" data-action="inbox" aria-label="Tin nhắn">${icon('message')}</button>
    <button type="button" class="icon mobile-menu" data-action="menu" aria-label="Mở menu">${icon('menu')}</button>
    <a class="button post-button" href="post.html">${icon('plus')}<span>Đăng tin</span></a></div>
  </div></div>`;
}
function footer() {
  select('#footer').innerHTML = `<div class="wrap footer-grid">
    <section><a class="footer-name" href="index.html">Chợ Phú Thịnh<span class="brand-dot"></span></a><p>Gần nhau hơn, dùng đồ lâu hơn.</p><p>Một góc chợ cho sinh viên và mọi người.</p></section>
    <nav aria-label="Các khu chợ"><h2>Đi một vòng chợ</h2>${marketZones.map((zone) => `<a href="${zoneUrl(zone.id)}">${zone.name}</a>`).join('')}</nav>
    <nav aria-label="Hỗ trợ"><h2>Góc của bạn</h2><a href="wishlist.html">Tin đã lưu</a><a href="post.html">Đăng tin</a><a href="my-listings.html">Tin của tôi</a><a href="landing.html">Giới thiệu chợ</a><a href="contact.html">Về chợ & liên hệ</a></nav>
  </div><div class="wrap footer-base"><span>© Chợ Phú Thịnh</span></div>`;
}
function price(listing) {
  return listing.price === 0 ? (listing.unit ? 'Thỏa thuận' : 'Tặng lại') : formatMoney(listing.price) + (listing.unit ? `<small>/${escapeHTML(listing.unit)}</small>` : '');
}
function photo(listing, eager = false) {
  const image = listing.image ?? '';
  if (/^\/api\/photos\/[a-f0-9]{32}$/.test(image)) {
    return `<span class="media"><img src="${image}" alt="${escapeHTML(listing.title)}" loading="${eager ? 'eager' : 'lazy'}"></span>`;
  }
  const zone = zoneById(listing.zone);
  return `<span class="media photo-placeholder ${zone.color}"><span>${icon('image')}<small>Chưa có ảnh</small></span><strong aria-hidden="true">${zone.mark}</strong></span>`;
}
function listingGallery(item) {
  const images = item.images?.filter((url) => /^\/api\/photos\/[a-f0-9]{32}(?:\/[2-5])?$/.test(url)) ?? [];
  if (images.length < 2) return photo(item, true);
  return `<div class="listing-gallery">
    <span class="media gallery-stage"><img src="${images[0]}" alt="${escapeHTML(item.title)} · Ảnh 1"></span>
    <div class="photo-thumbnails" role="group" aria-label="Ảnh của tin đăng">
      ${images.map((url, index) => `<button type="button" data-gallery-photo="${url}" data-photo-number="${index + 1}"
        aria-pressed="${index === 0}" aria-label="Xem ảnh ${index + 1}"><img src="${url}" alt="" loading="lazy"></button>`).join('')}
    </div>
  </div>`;
}
function card(listing) {
  const zone = zoneById(listing.zone);
  return `<article class="listing-card" data-listing="${listing.id}">
    <a class="card-photo" href="${listingUrl(listing)}">${photo(listing)}<span class="photo-label${listing.quantity === 0 ? ' sold-out' : ''}">${listing.quantity === 0 ? 'Hết hàng · Sold out' : escapeHTML(listing.category)}</span></a>
    <button class="icon save" type="button" data-save="${listing.id}" aria-label="Lưu tin ${escapeHTML(listing.title)}" aria-pressed="${saved.includes(listing.id)}">${icon('heart')}</button>
    <div class="card-copy"><p class="card-category">${zone.name} · ${escapeHTML(listing.attribute)}${listing.sharedRoom ? ' · Ở ghép' : ''}</p>
    <h3><a href="${listingUrl(listing)}">${escapeHTML(listing.title)}</a></h3><p class="price">${price(listing)}</p>
    ${listing.quantity > 0 ? `<p class="stock-count">Còn ${listing.quantity} món</p>` : ''}
    <p class="location">${icon('pin')}${escapeHTML(listing.location)}${listing.area ? ' · ' + listing.area + ' m²' : ''}</p></div>
  </article>`;
}
function zoneCards() {
  return marketZones.map((zone) => `<a class="zone-card ${zone.color}" href="${zoneUrl(zone.id)}">
    <span class="zone-mark">${zone.mark}</span><h3>${zone.name}</h3><p>${zone.description}</p><span class="zone-link">Ghé khu này ${icon('arrow')}</span></a>`).join('');
}
const categoryPhotos = {
  'Áo': 'uq-cat-somi.jpg', 'Quần': 'uq-cat-quan.jpg',
  'Váy & đầm': 'uq-cat-dam.jpg', 'Túi & phụ kiện': 'uq-cat-phukien.png',
};
const categoryIcons = { 'do-cu': 'parcel', 'phong-tro': 'room', 'tai-lieu': 'book', 'viec-lam': 'work' };
function categoryTile(zone, category, href, selected = false) {
  return `<li><a class="category-link" href="${escapeHTML(href)}"${selected ? ' aria-current="true"' : ''} data-category="${escapeHTML(category)}">
    <span class="category-art" aria-hidden="true">${Object.hasOwn(categoryPhotos, category)
      ? `<img src="Images/${categoryPhotos[category]}" alt="" loading="lazy" width="76" height="76">`
      : icon(categoryIcons[zone.id])}</span>
    <span>${escapeHTML(category)}</span>
  </a></li>`;
}
function categoryFilterUrl(category, search) {
  const next = new URLSearchParams(search);
  if (category) next.set('category', category);
  else next.delete('category');
  return 'shop.html?' + next + '#tin-trong-khu';
}
function zoneCategories(zone, selected) {
  return `<section class="wrap zone-categories" aria-labelledby="zone-category-heading">
    <div class="section-heading">
      <h2 id="zone-category-heading">Tìm theo danh mục</h2>
      <a class="text-link" data-category="" href="${escapeHTML(categoryFilterUrl('', params))}">Xem tất cả tin ${icon('arrow')}</a>
    </div>
    <ul class="category-grid">${zone.categories.map((category) =>
      categoryTile(zone, category, categoryFilterUrl(category, params), category === selected)
    ).join('')}</ul>
  </section>`;
}
function homeRecommendations() {
  const views = readViews();
  if (!views.length) return '';
  const picks = recommendedListings(views);
  return `<section class="wrap section recommendations" aria-labelledby="recommendations-title">
    <div class="section-heading">
      <div><h2 id="recommendations-title">Gợi ý cho bạn</h2>
      <p>${picks.length ? 'Dựa trên danh mục bạn hay xem trên trình duyệt này.' : 'Tin gợi ý sẽ hiện ở đây sau khi có hai lượt xem trong cùng một danh mục.'}</p></div>
      <button class="text-link" type="button" data-action="clear-views">Xóa lịch sử xem</button>
    </div>
    ${picks.length ? `<div class="listing-grid">${picks.map(card).join('')}</div>` : ''}
  </section>`;
}
function home() {
  return `<section class="market-hero" aria-labelledby="market-title">
    <img class="market-hero-photo" src="Images/DSC_4753.jpg" alt="" width="960" height="640" fetchpriority="high">
    <div class="market-hero-copy">
      <h1 id="market-title">Chợ Phú Thịnh</h1>
      <p>Đồ second hand, nhà thuê, sách và việc làm cho sinh viên và mọi người.</p>
      <a class="button" href="#cac-khu">Dạo chợ ${icon('arrow')}</a>
    </div>
  </section>
  <section class="wrap section home-zones" id="cac-khu" aria-labelledby="home-zones-heading">
    <div class="section-heading"><h2 id="home-zones-heading" tabindex="-1">Ghé từng khu chợ</h2></div>
    <div class="zone-grid">${zoneCards()}</div>
  </section>
  <div id="home-recommendations">${homeRecommendations()}</div>
  <section class="wrap section"><div class="section-heading"><div><p class="eyebrow">Có thể bạn đang tìm</p><h2>Ghé xem những tin này</h2></div><a class="text-link" href="shop.html">Xem tất cả ${icon('arrow')}</a></div>
    ${listings.length ? `<div class="listing-grid">${listings.slice(0, 4).map(card).join('')}</div>` : '<p class="market-empty">Chợ đang chờ những tin đăng đầu tiên. <a href="post.html">Đăng tin</a></p>'}
  </section>
  <section class="wrap invite"><div><p class="eyebrow">Góp một góc nhỏ vào chợ</p><h2>Có thứ bạn muốn<br>trao lại?</h2></div><div><p>Một món đồ, một cuốn sách, một căn phòng hay một cơ hội việc làm. Bắt đầu bằng một tin đăng.</p><a class="button dark" href="post.html">Đăng tin của bạn ${icon('plus')}</a></div></section>`;
}

const deliveryLabels = { direct: 'Nhận trực tiếp', arrange: 'Giao hàng theo thỏa thuận', both: 'Chấp nhận cả hai' };
function matchesDelivery(delivery, filter) {
  return !filter || delivery === filter || (delivery === 'both' && ['direct', 'arrange'].includes(filter));
}
const exchangeZones = ['do-cu', 'tai-lieu'];
const regionNames = Object.keys(marketRegions).sort(new Intl.Collator('vi').compare);
const wardNames = (province) => Object.hasOwn(marketRegions, province) ? marketRegions[province] : [];
const option = (name, selected, value = name) =>
  `<option value="${escapeHTML(value)}"${value === selected ? ' selected' : ''}>${escapeHTML(name)}</option>`;
function locationFields(post = false) {
  const province = post ? '' : params.get('province') ?? '';
  const ward = post ? '' : params.get('ward') ?? '';
  return `<div class="${post ? 'form-pair' : ''}" data-location>
    <label class="field">Tỉnh/thành<select name="province">
      ${option(post ? 'Chọn tỉnh/thành' : 'Tất cả tỉnh/thành', province, '')}
      ${regionNames.map((name) => option(name, province)).join('')}
    </select></label>
    <label class="field">Phường/xã<select name="ward">
      ${option(post ? 'Chọn phường/xã' : 'Tất cả phường/xã', ward, '')}
      ${wardNames(province).map((name) => option(name, ward)).join('')}
    </select></label></div>`;
}
function deliveryField(post = false) {
  return `<label class="field" data-delivery>Cách nhận<select name="delivery">
    ${option(post ? 'Chọn cách nhận' : 'Tất cả cách nhận', post ? '' : params.get('delivery'), '')}
    ${Object.entries(deliveryLabels).map(([value, name]) => option(name, post ? '' : params.get('delivery'), value)).join('')}
  </select></label>`;
}
function syncLocation(form, resetWard = false) {
  const { province, ward, remote } = form.elements;
  const post = form.id === 'post-form';
  const isRemote = !!remote && !remote.disabled && remote.checked;
  if (resetWard) {
    ward.innerHTML = option(post ? 'Chọn phường/xã' : 'Tất cả phường/xã', '', '') +
      wardNames(province.value).map((name) => option(name)).join('');
  }
  province.disabled = isRemote;
  ward.disabled = isRemote || !province.value;
  province.required = post && !isRemote;
  ward.required = post && !ward.disabled;
}

function catalog() {
  const zone = activeZone;
  const requestedCategory = params.get('category');
  const previous = zone?.previousCategories;
  const category = previous && Object.hasOwn(previous, requestedCategory) ? previous[requestedCategory] : requestedCategory;
  return `<section class="zone-hero ${zone?.color ?? 'pink'}"><div class="wrap"><p class="eyebrow">${zone ? 'Một góc Chợ Phú Thịnh' : 'Đi một vòng chợ'}</p><h1>${zone ? escapeHTML(zone.heading).replaceAll('\n', '<br>') : 'Tất cả tin trong chợ'}</h1><p>${zone?.description ?? 'Tìm đồ, chỗ ở, sách và công việc phù hợp với bạn.'}</p></div></section>
    ${zone ? zoneCategories(zone, category) : ''}
    <div class="wrap catalog-layout"><aside class="filters"><form id="filters">
      <label class="field">Tìm kiếm<input type="search" name="q" value="${escapeHTML(params.get('q') ?? '')}" placeholder="Nhập từ khóa"></label>
      <label class="field">Khu chợ<select name="zone"><option value="">Tất cả các khu</option>${marketZones.map((item) => `<option value="${item.id}"${item.id === zone?.id ? ' selected' : ''}>${item.name}</option>`).join('')}</select></label>
      <label class="field">Danh mục<select name="category"><option value="">Tất cả danh mục</option>${(zone?.categories ?? []).map((name) => option(name, category)).join('')}</select></label>
      ${zone ? `<label class="field">${zone.filterLabel}<select name="attribute"><option value="">Tất cả</option>${zone.filters.map((name) => `<option${params.get('attribute') === name ? ' selected' : ''}>${name}</option>`).join('')}</select></label>` : ''}
      ${!zone || zone.id === 'viec-lam' ? `<label class="check-field"><input type="checkbox" name="remote"${params.get('remote') === 'on' ? ' checked' : ''}> Chỉ việc làm từ xa</label>` : ''}
      ${locationFields()}
      ${!zone || exchangeZones.includes(zone.id) ? deliveryField() : ''}
      <div class="price-fields"><label class="field">Giá từ<input name="min" type="number" min="0" step="1000" value="${escapeHTML(params.get('min') ?? '')}" placeholder="0"></label><label class="field">Đến<input name="max" type="number" min="0" step="1000" value="${escapeHTML(params.get('max') ?? '')}" placeholder="Bất kỳ"></label></div>
      ${zone?.id === 'viec-lam' ? '<p class="field-hint">Chọn cách tính lương để so sánh mức lương cùng đơn vị.</p>' : ''}
      <button class="button dark">Áp dụng bộ lọc</button><a class="clear-link" href="${zone ? zoneUrl(zone.id) : 'shop.html'}">Xóa bộ lọc</a>
    </form></aside>
    <section id="tin-trong-khu" tabindex="-1" aria-label="Kết quả tìm tin"><div class="results-heading"><p id="result-count" role="status"></p><label>Sắp xếp <select name="sort" form="filters"><option value="new">Mới nhất</option><option value="low"${params.get('sort') === 'low' ? ' selected' : ''}>Giá thấp đến cao</option><option value="high"${params.get('sort') === 'high' ? ' selected' : ''}>Giá cao đến thấp</option></select></label></div>
      <div id="results"></div>
    </section></div>`;
}
function renderResults() {
  const form = select('#filters');
  const filters = new FormData(form);
  const q = normalize(String(filters.get('q') ?? '').trim());
  const min = filters.get('min') === '' ? 0 : Number(filters.get('min'));
  const max = filters.get('max') === '' ? Infinity : Number(filters.get('max'));
  if (min > max) {
    select('#result-count').textContent = 'Giá tối đa cần lớn hơn hoặc bằng giá tối thiểu.';
    select('#results').innerHTML = '';
    return;
  }
  let results = allListings().filter((item) => {
    const text = normalize([item.title, item.detail, item.category, item.location].join(' '));
    return (!filters.get('zone') || item.zone === filters.get('zone'))
      && (!filters.get('category') || item.category === filters.get('category'))
      && (!filters.get('attribute') || item.attribute === filters.get('attribute'))
      && (!filters.get('province') || item.province === filters.get('province'))
      && (!filters.get('ward') || item.ward === filters.get('ward'))
      && matchesDelivery(item.delivery, filters.get('delivery'))
      && (!filters.get('remote') || item.remote)
      && (!q || q.split(/\s+/).every((word) => text.includes(word)))
      && item.price >= min && item.price <= max;
  });
  const sort = filters.get('sort');
  if (sort === 'low') results.sort((a, b) => a.price - b.price);
  if (sort === 'high') results.sort((a, b) => b.price - a.price);
  select('#result-count').textContent = results.length + ' tin đăng';
  select('#results').innerHTML = results.length
    ? `<div class="listing-grid">${results.map(card).join('')}</div>`
    : empty('Chưa tìm thấy tin phù hợp.', 'Thử đổi từ khóa hoặc xóa một vài bộ lọc.');
}
function empty(title, detail = '') {
  return `<div class="empty"><h2>${title}</h2><p>${detail}</p><a class="button outline" href="shop.html">Dạo chợ</a></div>`;
}

function detail() {
  const item = listingById(params.get('id'));
  if (!item) return `<div class="wrap section">${empty('Tin này hiện chưa có.', 'Bạn có thể tìm một tin khác trong chợ.')}</div>`;
  const zone = zoneById(item.zone);
  document.title = item.title + ' | Chợ Phú Thịnh';
  const related = allListings().filter((entry) => entry.id !== item.id && entry.zone === item.zone).slice(0, 4);
  return `<div class="wrap section detail-page"><nav class="breadcrumb" aria-label="Đường dẫn"><a href="index.html">Chợ Phú Thịnh</a><span>/</span><a href="${zoneUrl(zone.id)}">${zone.name}</a></nav>
    <div class="detail-layout"><div class="detail-photo">${listingGallery(item)}</div>
    <div class="detail-copy"><p class="eyebrow">${zone.name} / ${escapeHTML(item.category)}${item.sharedRoom ? ' · Ở ghép' : ''}</p><h1>${escapeHTML(item.title)}</h1><p class="detail-price">${price(item)}</p>
      <p class="location">${icon('pin')}${escapeHTML(item.location)}</p>
      ${Number.isInteger(item.quantity) ? `<p class="stock-count${item.quantity === 0 ? ' sold-out' : ''}">${item.quantity === 0 ? 'Hết hàng · Sold out' : 'Số lượng còn: ' + item.quantity}</p>` : ''}
      <dl class="facts"><div><dt>${zone.filterLabel}</dt><dd>${escapeHTML(item.attribute)}</dd></div>${item.area ? `<div><dt>Diện tích</dt><dd>${item.area} m²</dd></div>` : ''} ${item.delivery ? `<div><dt>Cách nhận</dt><dd>${deliveryLabels[item.delivery]}</dd></div>` : ''}<div><dt>Người đăng</dt><dd>${escapeHTML(item.seller)}</dd></div></dl>
      ${item.amenities?.length ? `<div class="tags">${item.amenities.map((tag) => `<span>${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
      <div class="detail-actions">${mine.includes(item.id) ? '' : `<button class="button dark" data-contact="${item.id}">Nhắn người đăng ${icon('arrow')}</button>`}<button class="button outline" data-save="${item.id}" aria-pressed="${saved.includes(item.id)}">${icon('heart')}Lưu tin</button></div>
    </div></div>
    <section class="detail-description"><h2>Thông tin chi tiết</h2><p>${escapeHTML(item.detail)}</p></section>
    ${related.length ? `<section class="section"><div class="section-heading"><h2>Cùng khu ${zone.name.toLowerCase()}</h2><a class="text-link" href="${zoneUrl(zone.id)}">Xem thêm ${icon('arrow')}</a></div><div class="listing-grid">${related.map(card).join('')}</div></section>` : ''}
  </div>`;
}

function wishlist() {
  const entries = allListings().filter((item) => saved.includes(item.id));
  return `<section class="wrap section"><div class="section-heading"><div><p class="eyebrow">Góc của bạn</p><h1>Tin đã lưu</h1></div></div>${!user ? signInPrompt('Đăng nhập để xem tin đã lưu.') : entries.length ? `<div class="listing-grid">${entries.map(card).join('')}</div>` : empty('Bạn chưa lưu tin nào.', 'Bấm trái tim trên một tin để tìm lại sau.')}</section>`;
}
function myPosts() {
  return `<section class="wrap section"><div class="section-heading"><div><p class="eyebrow">Góc của bạn</p><h1>Tin của tôi</h1></div><a class="button dark" href="post.html">Đăng tin mới</a></div>${!user ? signInPrompt('Đăng nhập để quản lý tin của bạn.') : mine.length
    ? `<div class="listing-grid">${allListings().filter((item) => mine.includes(item.id)).map((item) => `<div>${card(item)}
      <div class="listing-tools">
        ${exchangeZones.includes(item.zone) ? `<button type="button" class="delete-link" data-stock="${item.id}">Chỉnh số lượng</button>` : ''}
        <button type="button" class="delete-link" data-delete="${item.id}">Xóa tin này</button>
      </div></div>`).join('')}</div>`
    : empty('Bạn chưa có tin đăng.', 'Đăng một món đồ hoặc chia sẻ một cơ hội với mọi người.')}</section>`;
}
function signInPrompt(message) {
  return `<div class="empty"><p>${message}</p><button class="button dark" data-action="account">Đăng nhập / Đăng ký</button></div>`;
}
function quantityField(value = 1) {
  return `<label class="field">Số lượng còn
    <input type="number" name="quantity" min="0" max="9999" step="1" value="${Number.isInteger(value) ? value : ''}" required>
    <small>Nhập 0 để hiện trạng thái hết hàng.</small>
  </label>`;
}
function postPage() {
  if (!user) return `<section class="wrap section"><h1>Đăng tin của bạn</h1>${signInPrompt('Đăng nhập để đăng tin lên chợ.')}</section>`;
  return `<section class="wrap post-page section"><p class="eyebrow">Góp một góc nhỏ vào chợ</p><h1>Đăng tin của bạn</h1><p class="page-lead">Chọn đúng khu để mọi người dễ tìm thấy tin.</p>
    <form id="post-form" class="post-form"><div class="form-pair">
      <label class="field">Khu chợ<select name="zone" required>${marketZones.map((zone) => `<option value="${zone.id}">${zone.name}</option>`).join('')}</select></label>
      <label class="field">Danh mục<select name="category" required></select></label></div>
      <label class="field">Tiêu đề<input name="title" required minlength="5" maxlength="100" placeholder="Bạn muốn đăng món đồ hay cơ hội gì?"></label>
      <div class="form-pair"><label class="field"><span id="post-price-label">Giá bán (₫)</span><input type="number" name="price" min="0" max="100000000000" step="1" required><small id="post-price-hint"></small></label>
      <label class="field"><span id="post-attribute-label">Tình trạng</span><select name="attribute" required></select></label></div>
      <label class="check-field" data-remote hidden><input type="checkbox" name="remote" disabled> Làm từ xa</label>
      ${locationFields(true)}
      ${deliveryField(true)}
      <div data-quantity>${quantityField()}</div>
      <label class="field">Mô tả<textarea name="detail" rows="5" required minlength="15" maxlength="2500" placeholder="Mô tả tình trạng, đặc điểm hoặc yêu cầu cụ thể"></textarea></label>
      <div class="field">
        <label for="post-photos">Ảnh tin đăng</label>
        <input id="post-photos" name="photo" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby="photo-hint">
        <small id="photo-hint">Tối đa 5 ảnh JPG, PNG hoặc WebP, mỗi ảnh tối đa 1 MB. Ảnh bìa sẽ hiện trên danh sách tin.</small>
        <p id="photo-status" role="status">0/5 ảnh</p>
        <div id="photo-previews" class="photo-previews" aria-label="Xem trước ảnh tin đăng"></div>
      </div>
      <p id="post-error" class="form-error" role="alert"></p><button class="button dark">Đăng tin ${icon('plus')}</button>
    </form></section>`;
}
function updatePostFields() {
  const form = select('#post-form');
  const zone = zoneById(form.elements.zone.value);
  form.elements.category.innerHTML = zone.categories.map((name) => `<option>${name}</option>`).join('');
  form.elements.attribute.innerHTML = zone.filters.map((name) => option(name)).join('');
  const remote = form.elements.remote;
  remote.disabled = zone.id !== 'viec-lam';
  if (remote.disabled) remote.checked = false;
  form.querySelector('[data-remote]').hidden = remote.disabled;
  const delivery = form.elements.delivery;
  delivery.disabled = !exchangeZones.includes(zone.id);
  delivery.required = !delivery.disabled;
  form.querySelector('[data-delivery]').hidden = delivery.disabled;
  form.elements.quantity.disabled = delivery.disabled;
  form.querySelector('[data-quantity]').hidden = delivery.disabled;
  select('#post-price-hint').textContent = delivery.disabled ? 'Điền 0 nếu giá hoặc lương theo thỏa thuận.' : 'Điền 0 nếu muốn tặng lại.';
  syncLocation(form);
  select('#post-price-label').textContent = zone.priceLabel + ' (₫)';
  select('#post-attribute-label').textContent = zone.filterLabel;
}
function aboutPage() {
  return `<section class="wrap about section"><p class="eyebrow">Chợ Phú Thịnh</p><h1>Một góc chợ,<br>nhiều cuộc gặp.</h1>
    <p class="about-lead">Chợ Phú Thịnh bắt đầu từ những nhu cầu quen thuộc của sinh viên, và chào đón tất cả mọi người.</p>
    <div class="zone-grid">${zoneCards()}</div><section class="about-text"><h2>Ghé chợ theo cách của bạn</h2><p>Tìm món đồ hợp túi tiền, trao lại cuốn sách đã đọc, tìm một phòng trọ hoặc một công việc phù hợp. Mỗi tin thuộc một khu riêng, với bộ lọc theo thông tin cần thiết.</p><a class="button dark" href="post.html">Đăng tin</a></section></section>`;
}

const templates = {
  index: home, shop: catalog, product: detail, wishlist,
  post: postPage, 'my-listings': myPosts,
  contact: aboutPage, blog: aboutPage, article: aboutPage,
  cart: wishlist, checkout: myPosts,
};
function render() {
  header();
  footer();
  select('#main').innerHTML = (templates[page] ?? home)();
  if (page === 'shop') {
    syncLocation(select('#filters'));
    renderResults();
    if (location.hash === '#tin-trong-khu') {
      const results = select('#tin-trong-khu');
      results.focus({ preventScroll: true });
      results.scrollIntoView();
    }
  }
  if (select('#post-form')) updatePostFields();
}
async function start() {
  if (location.protocol === 'file:') {
    header();
    footer();
    const file = location.pathname.split('/').pop();
    const host = new URL('http://127.0.0.1:8000/');
    host.pathname = /^[a-z-]+\.html$/.test(file) ? file : '';
    host.search = location.search;
    select('#main').innerHTML = `<div class="wrap section connection-help">
      <h1>Mở Chợ Phú Thịnh</h1>
      <p>Bạn đang mở tệp HTML. Nếu máy chủ chưa chạy, bấm đúp vào <strong>Mo-Cho-Phu-Thinh.cmd</strong> trong thư mục chợ.</p>
      <p><a class="button dark" href="${escapeHTML(host.href)}">Vào chợ trên máy này</a></p>
    </div>`;
    return;
  }
  try {
    ({ user, listings, mine, saved, providers = [], pendingSignup = false } = await api('state'));
  } catch {
    header();
    footer();
    select('#main').innerHTML = '<div class="wrap section connection-help"><h1>Chưa kết nối được với chợ</h1><p>Kiểm tra máy chủ rồi tải lại trang. Nếu đang mở GitHub Pages, hãy mở bản chạy trên máy của bạn.</p><p><a class="button dark" href="">Tải lại trang</a></p></div>';
    return;
  }
  if (page === 'product') recordView(listingById(params.get('id')));
  render();
  const authStatus = location.hash.match(/^#market-auth-(complete|expired|cancelled|failed)$/)?.[1];
  if (authStatus === 'complete' && pendingSignup) {
    finishSocialSignup();
  } else if (authStatus) {
    history.replaceState(null, '', location.pathname + location.search);
    const messages = {
      complete: 'Phiên đăng ký đã hết hạn. Hãy bắt đầu lại.',
      expired: 'Phiên đăng nhập đã hết hạn. Hãy thử lại.',
      cancelled: 'Bạn đã hủy đăng nhập.',
      failed: 'Chưa đăng nhập được với nhà cung cấp. Hãy thử lại.',
    };
    account(false, messages[authStatus]);
  }
}
start();
window.addEventListener('pageshow', (event) => {
  const recommendations = select('#home-recommendations');
  if (event.persisted && recommendations) recommendations.innerHTML = homeRecommendations();
});

function openDialog(title, body) {
  const dialog = select('#dialog');
  dialog.innerHTML = `<div class="dialog-top"><h2 id="dialog-title">${escapeHTML(title)}</h2><form method="dialog"><button class="icon" aria-label="Đóng">${icon('close')}</button></form></div><div class="dialog-body">${body}</div>`;
  if (!dialog.open) dialog.showModal();
}

function displayNameField() {
  return `<div class="field">
    <label for="auth-name">Tên hiển thị</label>
    <input id="auth-name" name="name" autocomplete="nickname" minlength="2" maxlength="50" placeholder="Ví dụ Mai Nhỏ" aria-describedby="auth-name-hint" required>
    <small id="auth-name-hint">Tên người khác thấy trên chợ. Bạn có thể dùng biệt danh.</small>
  </div>`;
}
function contactFields() {
  return `<fieldset class="auth-contact" aria-describedby="auth-contact-hint">
    <legend>Email hoặc số điện thoại</legend>
    <p id="auth-contact-hint">Chỉ cần điền một ô. Thông tin này được lưu riêng trong tài khoản.</p>
    <div class="field">
      <label for="auth-email">Email</label>
      <input id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="ten@vidu.vn">
    </div>
    <div class="field">
      <label for="auth-phone">Số điện thoại</label>
      <input id="auth-phone" name="phone" type="tel" autocomplete="tel" maxlength="32" placeholder="Nhập số điện thoại">
    </div>
  </fieldset>`;
}
function socialButtons() {
  const target = encodeURIComponent(location.pathname + location.search);
  const buttons = Object.entries({ google: 'Google', facebook: 'Facebook' }).map(([provider, name]) =>
    providers.includes(provider)
      ? `<a class="button outline" href="/api/oauth/${provider}/start?return=${target}">${name}</a>`
      : `<button class="button outline" type="button" disabled>${name}</button>`
  ).join('');
  return `<div class="auth-social"><p>Hoặc tiếp tục bằng</p><div class="auth-social-buttons">${buttons}</div>
    ${providers.length < 2 ? '<small>Nút đang mờ cần được cấu hình trên máy chủ.</small>' : ''}</div>`;
}
function finishSocialSignup() {
  openDialog('Hoàn tất tạo tài khoản', `<form id="auth-form" data-mode="social">
    ${displayNameField()}${contactFields()}
    <p class="form-error" role="alert"></p>
    <button class="button dark">Hoàn tất</button>
  </form>`);
}
function account(register = false, message = '') {
  if (user) {
    setAccountMenu(select('#account-menu').hidden);
    return;
  }
  openDialog(register ? 'Tạo tài khoản' : 'Đăng nhập', `<form id="auth-form" data-mode="${register ? 'register' : 'login'}">
    ${register ? displayNameField() : ''}
    <div class="field">
      <label for="auth-handle">Tên tài khoản</label>
      <input id="auth-handle" name="handle" autocomplete="username" pattern="[a-zA-Z0-9_]{3,30}" placeholder="${register ? 'Ví dụ mai_nho24' : 'Nhập tên tài khoản'}"${register ? ' aria-describedby="auth-handle-hint"' : ''} required>
      ${register ? '<small id="auth-handle-hint">Dùng để đăng nhập. Từ 3 đến 30 chữ không dấu, số hoặc dấu gạch dưới.</small>' : ''}
    </div>
    <div class="field">
      <label for="auth-password">Mật khẩu</label>
      <input id="auth-password" type="password" name="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="10" maxlength="128" placeholder="${register ? 'Tạo mật khẩu' : 'Nhập mật khẩu'}"${register ? ' aria-describedby="auth-password-hint"' : ''} required>
      ${register ? '<small id="auth-password-hint">Ít nhất 10 ký tự.</small>' : ''}
    </div>
    ${register ? contactFields() : ''}
    <p class="form-error" role="alert">${escapeHTML(message)}</p>
    <button class="button dark">${register ? 'Tạo tài khoản' : 'Đăng nhập'}</button>
    <p class="auth-switch">${register ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'} <button type="button" data-action="${register ? 'account' : 'register'}">${register ? 'Đăng nhập' : 'Tạo tài khoản'}</button></p>
  </form>${socialButtons()}`);
}
function accountMenu() {
  return `<nav id="account-menu" class="account-menu" aria-label="Tài khoản của bạn" hidden>
    <div class="account-menu-heading"><span class="account-avatar">${icon('account')}</span><strong>${escapeHTML(user.name)}</strong></div>
    <div class="account-menu-group">
      <a class="account-menu-row" href="my-listings.html">
        ${icon('listings')}<span>Tin của tôi</span><small aria-label="${mine.length} tin đang hiển thị">${mine.length}</small>
      </a>
      <a class="account-menu-row" href="wishlist.html">${icon('heart')}<span>Tin đã lưu</span></a>
      <button type="button" class="account-menu-row" data-action="inbox">${icon('message')}<span>Tin nhắn</span></button>
    </div>
    <div class="account-menu-group">
      <button type="button" class="account-menu-row" data-action="logout">${icon('logout')}<span>Đăng xuất</span></button>
    </div>
  </nav>`;
}
function setAccountMenu(open, returnFocus = false) {
  const menu = select('#account-menu');
  if (!menu) return;
  const toggle = select('#account-toggle');
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  if (returnFocus) toggle.focus();
}
function dismissAccountMenu(event) {
  const menu = select('#account-menu');
  if (menu && !menu.hidden && !event.target.closest('#account-menu, #account-toggle')) setAccountMenu(false);
}
document.addEventListener('focusin', dismissAccountMenu);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && select('#account-menu')?.hidden === false) {
    event.preventDefault();
    setAccountMenu(false, true);
  }
});
function messageForm(id, isThread = false) {
  return `<form id="message-form" data-target="${id}" data-thread="${isThread}">
    <label class="field">Lời nhắn<textarea rows="4" name="message" required maxlength="1000"></textarea></label>
    <p class="form-error" role="alert"></p><button class="button dark">Gửi lời nhắn</button></form>`;
}
async function inbox() {
  if (!user) return account();
  const threads = await api('threads');
  openDialog('Tin nhắn', threads.length ? `<div class="threads">${threads.map((thread) => `<button type="button" class="thread-row" data-thread="${thread.id}"><strong>${escapeHTML(thread.name)}</strong><span>${escapeHTML(thread.title)}</span></button>`).join('')}</div>` : '<p>Bạn chưa có cuộc trò chuyện nào.</p>');
}
async function openThread(id) {
  const messages = await api('threads/' + id);
  openDialog('Cuộc trò chuyện', `<button type="button" class="button outline" data-action="inbox">Về hộp thư</button>
    <div class="messages">${messages.map((entry) => `<div class="message-preview${entry.mine ? ' my-message' : ''}"><strong>${escapeHTML(entry.name)}</strong><p>${escapeHTML(entry.body)}</p></div>`).join('')}</div>${messageForm(id, true)}`);
  const history = select('.messages');
  history.scrollTop = history.scrollHeight;
}
document.addEventListener('click', async (event) => {
  dismissAccountMenu(event);
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.galleryPhoto) {
    const gallery = button.closest('.listing-gallery');
    const stage = gallery.querySelector('.gallery-stage img');
    stage.src = button.dataset.galleryPhoto;
    stage.alt = listingById(params.get('id')).title + ' · Ảnh ' + button.dataset.photoNumber;
    gallery.querySelector('[aria-pressed="true"]').setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-pressed', 'true');
    return;
  }
  const { coverPhoto, removePhoto } = button.dataset;
  if (coverPhoto !== undefined || removePhoto !== undefined) {
    if (removePhoto !== undefined) draftPhotos.splice(Number(removePhoto), 1);
    else draftPhotos.unshift(...draftPhotos.splice(Number(coverPhoto), 1));
    renderPhotoPreviews();
    const next = select('#photo-previews button') ?? select('#post-photos');
    next.focus();
    return;
  }
  const { action, save, contact, delete: removal, confirmDelete, thread, stock } = button.dataset;
  try {
    if (action === 'clear-views') {
      localStorage.removeItem(viewHistoryKey);
      select('#home-recommendations').replaceChildren();
      select('#home-zones-heading').focus({ preventScroll: true });
      toast('Đã xóa lịch sử xem.');
      return;
    }
    if (stock) {
      const item = listingById(stock);
      openDialog('Chỉnh số lượng', `<form id="stock-form" data-target="${item.id}">
        <p>${escapeHTML(item.title)}</p>${quantityField(item.quantity ?? null)}
        <p class="form-error" role="alert"></p><button class="button dark">Lưu số lượng</button>
      </form>`);
    }
    if (action === 'account' || action === 'register') account(action === 'register');
    if (action === 'logout') { await api('logout', 'POST'); location.reload(); }
    if (action === 'inbox') {
      if (button.closest('#account-menu')) setAccountMenu(false, true);
      await inbox();
    }
    if (thread) await openThread(thread);
    if (action === 'menu') {
      openDialog('Các khu trong chợ', `<nav class="dialog-menu"><a href="index.html">Trang chủ</a>${marketZones.map((zone) => `<a href="${zoneUrl(zone.id)}">${zone.name}</a>`).join('')}<a href="my-listings.html">Tin của tôi</a></nav>${searchForm(activeZone?.id)}`);
    }
    if (save) {
      if (!user) return account();
      button.disabled = true;
      const marked = !saved.includes(save);
      await api('saved/' + save, 'PUT', { saved: marked });
      saved = marked ? [...saved, save] : saved.filter((id) => id !== save);
      if (page === 'wishlist' || page === 'cart') render();
      document.querySelectorAll('[data-save]').forEach((control) => control.setAttribute('aria-pressed', saved.includes(control.dataset.save)));
      const badge = select('#saved-count');
      badge.textContent = saved.length;
      badge.hidden = !saved.length;
      toast(marked ? 'Đã lưu tin.' : 'Đã bỏ lưu tin.');
    }
    if (contact) {
      if (!user) return account();
      const item = listingById(contact);
      openDialog('Nhắn người đăng', `<p>Gửi ${escapeHTML(item.seller)} về tin <strong>${escapeHTML(item.title)}</strong></p>${messageForm(contact)}`);
    }
    if (removal) {
      const id = removal;
      openDialog('Gỡ tin đăng?', `<p>Tin sẽ được gỡ khỏi chợ.</p><div class="dialog-actions"><button class="button dark" data-confirm-delete="${id}">Gỡ tin</button><form method="dialog"><button class="button outline">Giữ lại</button></form></div>`);
    }
    if (confirmDelete) {
      button.disabled = true;
      await api('listings/' + confirmDelete, 'DELETE');
      listings = listings.filter((item) => item.id !== confirmDelete);
      mine = mine.filter((id) => id !== confirmDelete);
      saved = saved.filter((id) => id !== confirmDelete);
      select('#dialog').close();
      render();
      toast('Đã gỡ tin.');
    }
  } catch (error) {
    if (select('#dialog').open) {
      let status = select('#dialog [data-dialog-error]');
      if (!status) {
        status = document.createElement('p');
        status.className = 'form-error';
        status.setAttribute('role', 'alert');
        status.dataset.dialogError = '';
        select('#dialog .dialog-body').append(status);
      }
      status.textContent = error.message;
    } else toast(error.message);
  } finally {
    if (save || confirmDelete) button.disabled = false;
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id === 'post-photos') {
    await addDraftPhotos(event.target);
    return;
  }
  const control = event.target;
  const form = control.form;
  if (control.name === 'zone' && form?.id === 'filters') {
    const next = new URLSearchParams();
    if (control.value) next.set('zone', control.value);
    const keyword = form.elements.q.value.trim();
    if (keyword) next.set('q', keyword);
    location.href = 'shop.html' + (next.size ? '?' + next : '');
  }
  if (form?.id === 'post-form') {
    if (control.name === 'zone') updatePostFields();
    if (control.name === 'category' && control.value === 'Làm từ xa') {
      form.elements.remote.checked = true;
      syncLocation(form);
    }
    if (control.name === 'remote' && !control.checked && form.elements.category.value === 'Làm từ xa') {
      form.elements.category.selectedIndex = 0;
    }
  }
  if (['post-form', 'filters'].includes(form?.id) && ['province', 'remote'].includes(control.name)) {
    syncLocation(form, control.name === 'province');
  }
  if (control.name === 'sort' && form?.id === 'filters') renderResults();
});

async function readPhoto(file) {
  if (!file) return '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1048576) {
    throw new Error('Hãy chọn ảnh JPG, PNG hoặc WebP có dung lượng tối đa 1 MB.');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Chưa đọc được ảnh. Hãy thử tệp khác.'));
    reader.readAsDataURL(file);
  });
}
function renderPhotoPreviews() {
  select('#photo-status').textContent = draftPhotos.length + '/' + maxPhotos + ' ảnh';
  select('#photo-previews').innerHTML = draftPhotos.map(({ data, name }, index) => `<div class="photo-preview">
    <div class="photo-preview-image">
      <img src="${escapeHTML(data)}" alt="${escapeHTML(name)}">
      <button type="button" class="icon" data-remove-photo="${index}" aria-label="Bỏ ảnh ${index + 1}">${icon('close')}</button>
    </div>
    ${index === 0 ? '<span class="cover-label">Ảnh bìa</span>' : `<button type="button" class="cover-button" data-cover-photo="${index}" aria-label="Đặt làm bìa cho ảnh ${index + 1}">Đặt làm bìa</button>`}
  </div>`).join('');
}
async function addDraftPhotos(input) {
  const files = Array.from(input.files);
  input.value = '';
  if (!files.length) return;
  const error = select('#post-error');
  if (draftPhotos.length + files.length > maxPhotos) {
    error.textContent = 'Mỗi tin chỉ được tải tối đa 5 ảnh.';
    return;
  }
  const submit = select('#post-form button:not([type])');
  input.disabled = true;
  submit.disabled = true;
  error.textContent = '';
  select('#photo-status').textContent = 'Đang đọc ảnh…';
  try {
    const additions = await Promise.all(files.map(async (file) => ({ name: file.name, data: await readPhoto(file) })));
    draftPhotos.push(...additions);
  } catch (failure) {
    error.textContent = failure.message;
  } finally {
    input.disabled = false;
    submit.disabled = false;
    renderPhotoPreviews();
  }
}
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (form.id === 'filters') {
    event.preventDefault();
    const values = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (value) values.set(key, value);
    history.replaceState(null, '', 'shop.html' + (values.size ? '?' + values : ''));
    document.querySelectorAll('.zone-categories [data-category]').forEach((link) => {
      const category = link.dataset.category;
      link.href = categoryFilterUrl(category, values);
      if (category && category === values.get('category')) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
    renderResults();
    return;
  }
  if (!['auth-form', 'message-form', 'post-form', 'stock-form'].includes(form.id)) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const error = form.querySelector('.form-error');
  const submit = form.querySelector('button:not([type])');
  if (submit.disabled) return;
  const photoControls = form.id === 'post-form' ? form.querySelectorAll('#post-photos, #photo-previews button') : [];
  submit.disabled = true;
  photoControls.forEach((control) => { control.disabled = true; });
  error.textContent = '';
  try {
    if (form.id === 'auth-form') {
      const mode = form.dataset.mode;
      if (mode !== 'login' && !data.email.trim() && !data.phone.trim()) {
        form.elements.email.focus();
        throw new Error('Nhập email hoặc số điện thoại.');
      }
      const result = await api(mode === 'social' ? 'oauth/complete' : mode, 'POST', data);
      if (mode === 'social') {
        history.replaceState(null, '', result.destination);
      }
      location.reload();
    } else if (form.id === 'message-form') {
      const target = form.dataset.target;
      const path = form.dataset.thread === 'true' ? 'threads/' + target : 'messages';
      const { thread } = await api(path, 'POST', { listing: target, message: data.message });
      await openThread(thread);
    } else if (form.id === 'stock-form') {
      const item = listingById(form.dataset.target);
      const result = await api('listings/' + item.id, 'PUT', { quantity: Number(data.quantity) });
      item.quantity = result.quantity;
      select('#dialog').close();
      render();
      select(`[data-stock="${item.id}"]`)?.focus({ preventScroll: true });
      toast('Đã cập nhật số lượng.');
    } else {
      delete data.photo;
      data.price = Number(data.price);
      if (data.quantity !== undefined) data.quantity = Number(data.quantity);
      data.remote = data.remote === 'on';
      data.images = draftPhotos.map(({ data }) => data);
      const listing = await api('listings', 'POST', data);
      location.href = listingUrl(listing);
    }
  } catch (failure) {
    error.textContent = failure.message;
  } finally {
    submit.disabled = false;
    photoControls.forEach((control) => { control.disabled = false; });
  }
});

