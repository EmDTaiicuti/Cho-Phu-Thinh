'use strict';

const marketZones = [
  {
    id: 'do-cu', name: 'Đồ second hand', short: 'Đồ second hand', mark: 'ĐỒ CŨ',
    heading: 'Đồ còn tốt.\nTìm chủ mới.',
    description: 'Quần, áo, đồ dùng và đủ thứ hay ho đang chờ người dùng tiếp.',
    categories: ['Áo', 'Quần', 'Váy & đầm', 'Giày dép', 'Túi & phụ kiện', 'Đồ gia dụng', 'Điện tử', 'Nội thất', 'Đồ học tập', 'Thể thao & sở thích', 'Đồ khác'],
    filters: ['Còn mới', 'Đã qua sử dụng'],
    filterLabel: 'Tình trạng', priceLabel: 'Giá bán', color: 'pink',
  },
  {
    id: 'phong-tro', name: 'Nhà & phòng cho thuê', short: 'Nhà & phòng thuê', mark: 'CHỖ Ở',
    heading: 'Nhà & phòng\ncho thuê',
    description: 'Tìm nhà nguyên căn, chung cư hoặc phòng trọ theo khu vực và giá thuê.',
    categories: ['Nhà nguyên căn', 'Chung cư', 'Chung cư cao cấp', 'Chung cư mini', 'Phòng trọ', 'Trọ chung chủ', 'Trọ không chung chủ', 'KTX mini'],
    previousCategories: { 'Phòng riêng': 'Phòng trọ', 'Ở ghép': 'Phòng trọ', 'Căn hộ mini': 'Chung cư mini' },
    filters: ['Có nội thất', 'Nội thất cơ bản', 'Phòng trống'],
    filterLabel: 'Nội thất', priceLabel: 'Giá thuê / tháng', color: 'green',
  },
  {
    id: 'tai-lieu', name: 'Sách & tài liệu', short: 'Sách & tài liệu', mark: 'TRI THỨC',
    heading: 'Sách đã đọc.\nKiến thức còn mới.',
    description: 'Trao lại sách, giáo trình và ghi chép để người tiếp theo học tiếp.',
    categories: ['Giáo trình', 'Sách ngoại ngữ', 'Sách đọc', 'Ghi chép'],
    filters: ['Còn mới', 'Có ghi chú'],
    filterLabel: 'Tình trạng', priceLabel: 'Giá tài liệu', color: 'yellow',
  },
  {
    id: 'viec-lam', name: 'Việc làm', short: 'Việc làm', mark: 'CƠ HỘI',
    heading: 'Tìm việc hợp mình.\nBắt đầu gần nhà.',
    description: 'Khám phá việc bán thời gian, thực tập và công việc linh hoạt.',
    categories: ['Bán thời gian', 'Thực tập', 'Theo ca', 'Làm từ xa'],
    filters: ['Theo giờ', 'Theo tháng'],
    filterLabel: 'Cách tính lương', priceLabel: 'Mức lương', color: 'blue',
  },
];

if (typeof module !== 'undefined') module.exports = { marketZones };
