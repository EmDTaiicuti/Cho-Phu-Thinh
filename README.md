# Chợ Phú Thịnh

Chợ trực tuyến cho sinh viên và mọi người. Có bốn khu gồm Đồ second hand, Nhà & phòng cho thuê, Sách & tài liệu và Việc làm.

## Mở trên máy

Cần Node.js 24 trở lên. Trên Windows, bấm đúp `Mo-Cho-Phu-Thinh.cmd` để chạy máy chủ và mở chợ trong trình duyệt. Giữ cửa sổ lệnh mở khi dùng chợ.

Bạn cũng có thể mở PowerShell trong thư mục chứa `server.cjs` và chạy:

```powershell
node server.cjs
```

Mở [Chợ Phú Thịnh](http://127.0.0.1:8000/) trong khi cửa sổ PowerShell vẫn đang chạy. Tạo tài khoản qua nút hình người trên thanh menu. Mở cửa sổ riêng tư và tạo tài khoản thứ hai để xem tin và gửi lời nhắn cho tài khoản đầu tiên.

Tin đăng, ảnh, tài khoản, tin đã lưu và tin nhắn được lưu trong `.market-data/market.sqlite`. Các tài khoản dùng chung địa chỉ máy chủ sẽ xem cùng một danh sách tin. Khi sao lưu, dừng máy chủ rồi sao chép toàn bộ thư mục `.market-data`.

## Đăng ký và đăng nhập

Tài khoản mới cần tên hiển thị và ít nhất một thông tin liên hệ gồm email hoặc số điện thoại. Chợ kiểm tra định dạng khi đăng ký. Mục liên hệ được lưu trong cơ sở dữ liệu, không đưa lên tin công khai. Tài khoản Chợ Phú Thịnh hiện có vẫn đăng nhập bằng tên tài khoản và mật khẩu.

Để bật Google hoặc Facebook, tạo ứng dụng của chợ trong Google Cloud hoặc Meta for Developers và cấu hình biến môi trường trên máy chủ.

| Biến | Giá trị |
| --- | --- |
| `MARKET_ORIGIN` | Địa chỉ gốc của chợ, ví dụ `https://cho.example.vn` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth Client ID và secret của ứng dụng Web trên Google Cloud |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | App ID và App Secret của ứng dụng Facebook Login |
| `FACEBOOK_GRAPH_VERSION` | Phiên bản Graph API của ứng dụng Meta, mặc định `v27.0` |

Thêm URL chuyển hướng HTTPS tương ứng trong bảng điều khiển từng nhà cung cấp.

- Google dùng `<MARKET_ORIGIN>/api/oauth/google/callback`. Có thể thử cục bộ với origin `http://127.0.0.1:8000` và cùng URL chuyển hướng được đăng ký.
- Facebook dùng `<MARKET_ORIGIN>/api/oauth/facebook/callback`. Chỉ bật với origin HTTPS.

Giữ secret trong cấu hình máy chủ. Khởi động lại máy chủ sau khi sửa cấu hình. Đăng nhập lần đầu qua Google hoặc Facebook sẽ mở biểu mẫu nhập tên hiển thị và email hoặc số điện thoại. Mỗi tài khoản mạng xã hội được nhận diện riêng bằng ID của nhà cung cấp.

## Bộ lọc khu vực

Cả bốn khu dùng Tỉnh/thành và Phường/xã. Danh sách lấy từ hai cột tên trong tệp `mã xã phường, tỉnh, tp.xlsx`, gồm 34 tỉnh/thành và 3.321 phường, xã, đặc khu. Khi đăng Đồ second hand hoặc Sách & tài liệu, người đăng có thể chọn Nhận trực tiếp, Giao hàng theo thỏa thuận hoặc Chấp nhận cả hai. Tin việc làm có lựa chọn Làm từ xa.

## Số lượng và gợi ý

Tin Đồ second hand và Sách & tài liệu có số lượng còn. Người bán chỉnh trong **Tin của tôi**. Số lượng 0 hiện **Hết hàng · Sold out**, số lượng lớn hơn 0 mở bán lại. Tin cũ chưa có số lượng sẽ hiển thị số lượng sau khi người bán cập nhật.

Trang chủ gợi ý tối đa bốn tin dựa trên những danh mục bạn xem từ hai lượt. Lịch sử lưu 60 lượt gần nhất trong vòng 30 ngày trên trình duyệt. Dùng **Xóa lịch sử xem** để đặt lại gợi ý.

## Đưa lên mạng

GitHub Pages phục vụ tệp tĩnh. Chợ cần máy chủ chạy Node.js và lưu cơ sở dữ liệu SQLite trên ổ đĩa bền vững. Khi triển khai, đặt `MARKET_HOST=0.0.0.0`, `PORT` theo cấu hình của máy chủ, `MARKET_DATA_DIR` vào thư mục lưu dữ liệu bền vững và `MARKET_ORIGIN` bằng địa chỉ HTTPS công khai của chợ.

Ảnh banner `Images/DSC_4753.jpg` do người dùng cung cấp. Ảnh tin đăng được người đăng tải lên từ biểu mẫu. Danh mục các khu nằm trong `Scripts/market-data.js`.

