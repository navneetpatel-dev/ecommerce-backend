/**
 * The catalog tree: 10 departments, 60 categories, and what a product in each looks like
 * (names, the option a shopper chooses, price range, HSN code and GST rate, weight).
 */

export type Leaf = {
  name: string;
  hsn: string;
  gst: number;
  /** Selling price range in rupees, before GST. */
  price: [number, number];
  /** Shipping weight range in grams. */
  weight: [number, number];
  /** The option variants differ by, and its values. */
  option: [string, string[]];
  products: string[];
};

export type Department = {
  slug: string;
  name: string;
  commissionRate: number;
  returnWindowDays: number;
  warrantyMonths: number | null;
  brands: string[];
  material: string[];
  leaves: Leaf[];
};

const leaf = (
  name: string,
  hsn: string,
  gst: number,
  price: [number, number],
  weight: [number, number],
  option: [string, string[]],
  products: string[],
): Leaf => ({ name, hsn, gst, price, weight, option, products });

const COLOR: [string, string[]] = ['Color', ['Black', 'White', 'Navy', 'Olive', 'Maroon', 'Grey']];
const METAL: [string, string[]] = ['Color', ['Gold', 'Silver', 'Rose Gold']];
const SIZE: [string, string[]] = ['Size', ['S', 'M', 'L', 'XL', 'XXL']];
const FORMAT: [string, string[]] = ['Format', ['Paperback', 'Hardcover', 'Box Set']];
const PACK: [string, string[]] = ['Pack', ['250 g', '500 g', '1 kg']];
const VOLUME: [string, string[]] = ['Volume', ['50 ml', '100 ml', '200 ml']];

export const DEPARTMENTS: Department[] = [
  {
    slug: 'electronics', name: 'Electronics', commissionRate: 8, returnWindowDays: 7, warrantyMonths: 12,
    brands: ['TechNova', 'PulseGear', 'ZenByte', 'CircuitOne', 'VoltEdge', 'Orbit'], material: ['Aluminium', 'ABS', 'Glass'],
    leaves: [
      leaf('Laptops', '8471', 18, [24998, 89998], [1200, 2600], ['Storage', ['256 GB', '512 GB', '1 TB']], ['Ultrabook', 'Gaming Laptop', 'Everyday Notebook', 'Convertible Laptop']),
      leaf('Smartphones', '8517', 18, [6998, 49998], [160, 240], ['Storage', ['64 GB', '128 GB', '256 GB']], ['5G Smartphone', 'Camera Phone', 'Slim Phone', 'Rugged Phone']),
      leaf('Tablets', '8471', 18, [8998, 39998], [350, 700], ['Storage', ['64 GB', '128 GB', '256 GB']], ['Study Tablet', 'Drawing Tablet', 'Media Tablet', 'Compact Tablet']),
      leaf('Cameras', '8525', 18, [4998, 59998], [250, 900], COLOR, ['Mirrorless Camera', 'Action Camera', 'Instant Camera', 'Vlogging Camera']),
      leaf('Audio', '8518', 18, [498, 14998], [60, 900], COLOR, ['Wireless Earbuds', 'Over-Ear Headphones', 'Bluetooth Speaker', 'Soundbar']),
      leaf('Gaming', '9504', 18, [798, 29998], [200, 2500], COLOR, ['Game Controller', 'Mechanical Keyboard', 'Gaming Mouse', 'Gaming Headset']),
      leaf('Wearables', '8517', 18, [998, 19998], [40, 120], COLOR, ['Smart Watch', 'Fitness Band', 'Smart Ring', 'Kids Watch Phone']),
      leaf('Accessories', '8504', 18, [198, 3998], [40, 400], COLOR, ['Fast Charger', 'Power Bank', 'Braided Cable', 'Laptop Stand']),
    ],
  },
  {
    slug: 'fashion', name: 'Fashion', commissionRate: 15, returnWindowDays: 15, warrantyMonths: null,
    brands: ['Urban Loom', 'Thread & Co', 'NovaWear', 'ClassicFit', 'SilkRoute', 'Indigo'], material: ['Cotton', 'Linen', 'Leather', 'Denim'],
    leaves: [
      leaf('Men Clothing', '6203', 12, [398, 2998], [180, 700], SIZE, ['Casual Shirt', 'Chinos', 'Polo T-Shirt', 'Kurta']),
      leaf('Women Clothing', '6204', 12, [398, 3998], [180, 700], SIZE, ['Kurti', 'Summer Dress', 'Palazzo Set', 'Top']),
      leaf('Kids Clothing', '6111', 12, [298, 1498], [120, 400], SIZE, ['Play Set', 'Hoodie', 'Frock', 'Night Suit']),
      leaf('Shoes', '6403', 12, [698, 5998], [400, 900], ['Size', ['6', '7', '8', '9', '10']], ['Running Shoes', 'Loafers', 'Sneakers', 'Sandals']),
      leaf('Bags', '4202', 18, [498, 4998], [250, 1100], COLOR, ['Backpack', 'Tote Bag', 'Duffel Bag', 'Sling Bag']),
      leaf('Watches', '9102', 18, [798, 11998], [60, 180], COLOR, ['Analog Watch', 'Chronograph', 'Minimalist Watch', 'Sports Watch']),
      leaf('Sunglasses', '9004', 18, [398, 3998], [30, 80], COLOR, ['Aviator Sunglasses', 'Wayfarer', 'Round Sunglasses', 'Sports Shades']),
      leaf('Jackets', '6201', 12, [898, 6998], [450, 1300], SIZE, ['Bomber Jacket', 'Rain Jacket', 'Denim Jacket', 'Puffer Jacket']),
    ],
  },
  {
    slug: 'home', name: 'Home', commissionRate: 12, returnWindowDays: 10, warrantyMonths: 6,
    brands: ['HomeCraft', 'LivingEssentials', 'Nest & Bloom', 'ArtisanHome', 'PureNest', 'Banyan'], material: ['Steel', 'Wood', 'Ceramic', 'Glass'],
    leaves: [
      leaf('Furniture', '9403', 18, [1998, 19998], [4000, 14000], ['Finish', ['Walnut', 'Teak', 'White']], ['Coffee Table', 'Bookshelf', 'Study Desk', 'Accent Chair']),
      leaf('Kitchen', '7323', 12, [298, 4998], [300, 3500], ['Size', ['Small', 'Medium', 'Large']], ['Cookware Set', 'Knife Set', 'Pressure Cooker', 'Storage Jar Set']),
      leaf('Bedding', '6302', 12, [498, 3998], [500, 2200], ['Size', ['Single', 'Double', 'King']], ['Bedsheet Set', 'Comforter', 'Pillow Pair', 'Blanket']),
      leaf('Decor', '6913', 12, [198, 3498], [200, 2000], COLOR, ['Table Vase', 'Wall Clock', 'Photo Frame Set', 'Scented Candle Set']),
      leaf('Lighting', '9405', 18, [298, 4998], [250, 2000], ['Finish', ['Brass', 'Matte Black', 'White']], ['Floor Lamp', 'Pendant Light', 'Desk Lamp', 'String Lights']),
      leaf('Storage', '3924', 18, [198, 2498], [300, 2500], ['Size', ['Small', 'Medium', 'Large']], ['Drawer Organiser', 'Storage Box', 'Shoe Rack', 'Wardrobe Hanger Set']),
      leaf('Garden', '8201', 12, [198, 2998], [250, 3000], COLOR, ['Planter Set', 'Garden Tool Kit', 'Watering Can', 'Outdoor Lantern']),
      leaf('Tools', '8205', 18, [298, 5998], [300, 4000], COLOR, ['Tool Kit', 'Cordless Drill', 'Measuring Set', 'Step Ladder']),
    ],
  },
  {
    slug: 'sports', name: 'Sports', commissionRate: 10, returnWindowDays: 10, warrantyMonths: null,
    brands: ['ActivePulse', 'StrideMax', 'PeakForm', 'FlexRun', 'SportHive', 'Kairo'], material: ['Rubber', 'Nylon', 'Steel', 'Foam'],
    leaves: [
      leaf('Fitness', '9506', 12, [298, 7998], [300, 8000], COLOR, ['Dumbbell Pair', 'Resistance Band Set', 'Skipping Rope', 'Kettlebell']),
      leaf('Outdoor', '6306', 12, [498, 8998], [500, 4000], COLOR, ['Camping Tent', 'Sleeping Bag', 'Trekking Pole', 'Hiking Backpack']),
      leaf('Team Sports', '9506', 12, [298, 4998], [200, 1500], ['Size', ['Size 3', 'Size 4', 'Size 5']], ['Football', 'Cricket Bat', 'Volleyball', 'Basketball']),
      leaf('Cycling', '8714', 12, [198, 3998], [100, 1500], COLOR, ['Cycling Helmet', 'Bike Light Set', 'Cycling Gloves', 'Floor Pump']),
      leaf('Yoga', '9506', 12, [248, 2498], [150, 1600], COLOR, ['Yoga Mat', 'Yoga Block Pair', 'Yoga Strap', 'Meditation Cushion']),
      leaf('Swimming', '9506', 12, [198, 2498], [80, 500], COLOR, ['Swim Goggles', 'Swim Cap', 'Kickboard', 'Quick-Dry Towel']),
    ],
  },
  {
    slug: 'beauty', name: 'Beauty', commissionRate: 15, returnWindowDays: 7, warrantyMonths: null,
    brands: ['GlowKind', 'PureDerm', 'VelvetSkin', 'AuraCare', 'Botanica', 'Saffron'], material: ['Glass bottle', 'Recycled plastic', 'Paper carton'],
    leaves: [
      leaf('Skincare', '3304', 18, [198, 1998], [80, 300], VOLUME, ['Face Serum', 'Day Moisturiser', 'Sunscreen', 'Gentle Cleanser']),
      leaf('Makeup', '3304', 18, [148, 1498], [30, 150], ['Shade', ['Natural', 'Rose', 'Ivory', 'Cocoa']], ['Matte Lipstick', 'Foundation', 'Compact Powder', 'Kajal']),
      leaf('Haircare', '3305', 18, [198, 1298], [150, 500], VOLUME, ['Shampoo', 'Hair Oil', 'Conditioner', 'Hair Mask']),
      leaf('Fragrances', '3303', 18, [398, 3998], [100, 350], VOLUME, ['Eau de Parfum', 'Body Mist', 'Cologne', 'Attar']),
      leaf('Bath & Body', '3401', 18, [148, 998], [100, 500], VOLUME, ['Body Wash', 'Body Lotion', 'Bath Salt', 'Hand Cream']),
    ],
  },
  {
    slug: 'books', name: 'Books', commissionRate: 8, returnWindowDays: 7, warrantyMonths: null,
    brands: ['Inkwell', 'Paper Lantern', 'Quill House', 'Monsoon Press', 'Blue Margin', 'Mithila'], material: ['Paper'],
    leaves: [
      leaf('Fiction', '4901', 5, [148, 998], [200, 900], FORMAT, ['Novel', 'Short Story Collection', 'Mystery', 'Family Saga']),
      leaf('Non-Fiction', '4901', 5, [198, 1298], [250, 900], FORMAT, ['Memoir', 'History', 'Business Guide', 'Travelogue']),
      leaf('Children', '4903', 5, [98, 698], [150, 700], FORMAT, ['Picture Book', 'Bedtime Stories', 'Activity Book', 'Fable Collection']),
      leaf('Educational', '4901', 5, [198, 1498], [300, 1400], FORMAT, ['Workbook', 'Reference Guide', 'Exam Companion', 'Atlas']),
      leaf('Comics', '4902', 5, [98, 798], [150, 800], FORMAT, ['Graphic Novel', 'Comic Anthology', 'Manga Volume', 'Adventure Comic']),
    ],
  },
  {
    slug: 'toys', name: 'Toys', commissionRate: 12, returnWindowDays: 10, warrantyMonths: null,
    brands: ['PlayNest', 'Tiny Trails', 'BrightBricks', 'Wonder Crate', 'Jumpseed', 'Tanvi'], material: ['ABS', 'Wood', 'Soft fabric', 'Cardboard'],
    leaves: [
      leaf('Action Figures', '9503', 12, [198, 2498], [100, 700], ['Edition', ['Standard', 'Deluxe', 'Collector']], ['Hero Figure', 'Robot Warrior', 'Space Ranger', 'Dinosaur Figure']),
      leaf('Dolls', '9503', 12, [198, 1998], [150, 900], ['Edition', ['Standard', 'Deluxe', 'Collector']], ['Fashion Doll', 'Soft Doll', 'Doll House Set', 'Storybook Doll']),
      leaf('Building Blocks', '9503', 12, [298, 3998], [300, 2000], ['Set', ['100 pieces', '250 pieces', '500 pieces']], ['City Builder', 'Castle Blocks', 'Vehicle Blocks', 'Magnetic Tiles']),
      leaf('Educational', '9503', 12, [248, 2498], [200, 1500], ['Age', ['3-5', '6-8', '9-12']], ['Science Kit', 'Math Puzzle', 'Globe Explorer', 'Coding Robot']),
      leaf('Board Games', '9504', 12, [198, 1998], [250, 1600], ['Edition', ['Standard', 'Deluxe', 'Travel']], ['Strategy Game', 'Word Game', 'Family Quiz', 'Memory Game']),
    ],
  },
  {
    slug: 'food', name: 'Food', commissionRate: 10, returnWindowDays: 7, warrantyMonths: null,
    brands: ['Harvest Basket', 'Spice Meadow', 'Green Grain', 'Hill Orchard', 'Daily Roots', 'Kalash'], material: ['Resealable pouch', 'Glass jar', 'Tin'],
    leaves: [
      leaf('Snacks', '2106', 5, [98, 798], [250, 1100], PACK, ['Roasted Makhana', 'Trail Mix', 'Millet Crisps', 'Khakhra']),
      leaf('Beverages', '0902', 5, [148, 998], [250, 1100], PACK, ['Assam Tea', 'Filter Coffee', 'Herbal Infusion', 'Drinking Chocolate']),
      leaf('Organic', '1006', 5, [148, 898], [250, 1100], PACK, ['Basmati Rice', 'Jaggery Powder', 'Toor Dal', 'Wild Honey']),
      leaf('Gourmet', '2103', 5, [198, 1298], [250, 1100], PACK, ['Pesto', 'Artisan Pickle', 'Olive Spread', 'Truffle Seasoning']),
      leaf('Health Foods', '2106', 5, [198, 1498], [250, 1100], PACK, ['Protein Muesli', 'Chia Seeds', 'Nut Butter', 'Multigrain Mix']),
    ],
  },
  {
    slug: 'automotive', name: 'Automotive', commissionRate: 10, returnWindowDays: 7, warrantyMonths: 6,
    brands: ['RoadMate', 'TorqueLine', 'MotoCrest', 'DriveSure', 'AutoNest', 'Zephyr'], material: ['Steel', 'ABS', 'Rubber', 'Microfibre'],
    leaves: [
      leaf('Car Parts', '8708', 18, [298, 7998], [200, 4000], ['Fit', ['Hatchback', 'Sedan', 'SUV']], ['Wiper Blade Set', 'Air Filter', 'Brake Pad Set', 'Horn Pair']),
      leaf('Motorcycle', '8714', 18, [198, 4998], [150, 2500], COLOR, ['Riding Gloves', 'Bike Cover', 'Phone Mount', 'Saddle Bag']),
      leaf('Accessories', '8708', 18, [148, 2998], [100, 1500], COLOR, ['Seat Cushion', 'Dashboard Organiser', 'Car Perfume', 'Sun Shade']),
      leaf('Electronics', '8527', 18, [498, 9998], [150, 1500], COLOR, ['Dash Camera', 'Car Charger', 'Reverse Sensor', 'Tyre Inflator']),
      leaf('Tools', '8205', 18, [298, 3998], [300, 3500], COLOR, ['Jump Starter Cable', 'Wheel Wrench', 'Puncture Kit', 'Car Wash Kit']),
    ],
  },
  {
    slug: 'jewelry', name: 'Jewelry', commissionRate: 12, returnWindowDays: 7, warrantyMonths: null,
    brands: ['Aurelia', 'Meher', 'Chandni', 'Vistara', 'Solitaire Lane', 'Rivet & Gold'], material: ['Sterling silver', 'Gold plated brass', 'Stainless steel'],
    leaves: [
      leaf('Necklaces', '7113', 12, [498, 9998], [15, 90], METAL, ['Pendant Necklace', 'Layered Chain', 'Pearl Strand', 'Choker']),
      leaf('Earrings', '7113', 12, [198, 5998], [5, 40], METAL, ['Stud Earrings', 'Jhumka', 'Hoop Earrings', 'Drop Earrings']),
      leaf('Bracelets', '7117', 12, [248, 6998], [10, 70], METAL, ['Charm Bracelet', 'Tennis Bracelet', 'Cuff', 'Bangle Set']),
      leaf('Rings', '7113', 12, [298, 7998], [3, 20], METAL, ['Solitaire Ring', 'Stackable Ring Set', 'Signet Ring', 'Band']),
      leaf('Watches', '9102', 18, [998, 14998], [50, 180], METAL, ['Bracelet Watch', 'Dial Watch', 'Bangle Watch', 'Couple Watch Set']),
    ],
  },
];

export const LEAF_COUNT = DEPARTMENTS.reduce((total, department) => total + department.leaves.length, 0);
