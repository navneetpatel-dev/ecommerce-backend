/**
 * Regional shipping zones for the admin Shipping page: 100 zones, each on a real postal
 * prefix, with five platform rate slabs apiece. The seeded addresses and shops sit on
 * other prefixes, so no quote they already got changes.
 */
import { daysAgo, id, insert, int, pgArray, select } from './lib';

/** City and its three-digit postal prefix (the first three digits of its PIN codes). */
const REGIONS: ReadonlyArray<readonly [string, string, string]> = [
  ['Nagpur', '440', 'Maharashtra'], ['Nashik', '422', 'Maharashtra'], ['Aurangabad', '431', 'Maharashtra'],
  ['Kolhapur', '416', 'Maharashtra'], ['Solapur', '413', 'Maharashtra'], ['Amravati', '444', 'Maharashtra'],
  ['Satara', '415', 'Maharashtra'], ['Jalgaon', '425', 'Maharashtra'], ['Chandrapur', '442', 'Maharashtra'],
  ['Ahmednagar', '414', 'Maharashtra'], ['Panaji', '403', 'Goa'], ['Surat', '395', 'Gujarat'],
  ['Vadodara', '390', 'Gujarat'], ['Rajkot', '360', 'Gujarat'], ['Bhavnagar', '364', 'Gujarat'],
  ['Jamnagar', '361', 'Gujarat'], ['Gandhinagar', '382', 'Gujarat'], ['Anand', '388', 'Gujarat'],
  ['Mehsana', '384', 'Gujarat'], ['Bhuj', '370', 'Gujarat'], ['Silvassa', '396', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['Udaipur', '313', 'Rajasthan'], ['Jodhpur', '342', 'Rajasthan'], ['Kota', '324', 'Rajasthan'],
  ['Ajmer', '305', 'Rajasthan'], ['Bikaner', '334', 'Rajasthan'], ['Alwar', '301', 'Rajasthan'],
  ['Sikar', '332', 'Rajasthan'], ['Indore', '452', 'Madhya Pradesh'], ['Bhopal', '462', 'Madhya Pradesh'],
  ['Gwalior', '474', 'Madhya Pradesh'], ['Jabalpur', '482', 'Madhya Pradesh'], ['Ujjain', '456', 'Madhya Pradesh'],
  ['Sagar', '470', 'Madhya Pradesh'], ['Rewa', '486', 'Madhya Pradesh'], ['Raipur', '492', 'Chhattisgarh'],
  ['Bilaspur', '495', 'Chhattisgarh'], ['Durg', '491', 'Chhattisgarh'], ['Ambikapur', '497', 'Chhattisgarh'],
  ['Kanpur', '208', 'Uttar Pradesh'], ['Agra', '282', 'Uttar Pradesh'], ['Varanasi', '221', 'Uttar Pradesh'],
  ['Prayagraj', '211', 'Uttar Pradesh'], ['Meerut', '250', 'Uttar Pradesh'], ['Ghaziabad', '201', 'Uttar Pradesh'],
  ['Gorakhpur', '273', 'Uttar Pradesh'], ['Bareilly', '243', 'Uttar Pradesh'], ['Aligarh', '202', 'Uttar Pradesh'],
  ['Mathura', '281', 'Uttar Pradesh'], ['Jhansi', '284', 'Uttar Pradesh'], ['Moradabad', '244', 'Uttar Pradesh'],
  ['Saharanpur', '247', 'Uttar Pradesh'], ['Ayodhya', '224', 'Uttar Pradesh'], ['Dehradun', '248', 'Uttarakhand'],
  ['Haridwar', '249', 'Uttarakhand'], ['Haldwani', '263', 'Uttarakhand'], ['Shimla', '171', 'Himachal Pradesh'],
  ['Dharamshala', '176', 'Himachal Pradesh'], ['Mandi', '175', 'Himachal Pradesh'], ['Jammu', '180', 'Jammu and Kashmir'],
  ['Srinagar', '190', 'Jammu and Kashmir'], ['Leh', '194', 'Ladakh'], ['Amritsar', '143', 'Punjab'],
  ['Ludhiana', '141', 'Punjab'], ['Jalandhar', '144', 'Punjab'], ['Patiala', '147', 'Punjab'],
  ['Bathinda', '151', 'Punjab'], ['Gurugram', '122', 'Haryana'], ['Faridabad', '121', 'Haryana'],
  ['Panipat', '132', 'Haryana'], ['Hisar', '125', 'Haryana'], ['Rohtak', '124', 'Haryana'],
  ['Ambala', '133', 'Haryana'], ['Patna', '800', 'Bihar'], ['Gaya', '823', 'Bihar'],
  ['Muzaffarpur', '842', 'Bihar'], ['Bhagalpur', '812', 'Bihar'], ['Darbhanga', '846', 'Bihar'],
  ['Purnia', '854', 'Bihar'], ['Ranchi', '834', 'Jharkhand'], ['Jamshedpur', '831', 'Jharkhand'],
  ['Dhanbad', '826', 'Jharkhand'], ['Bokaro', '827', 'Jharkhand'], ['Bhubaneswar', '751', 'Odisha'],
  ['Cuttack', '753', 'Odisha'], ['Rourkela', '769', 'Odisha'], ['Sambalpur', '768', 'Odisha'],
  ['Berhampur', '760', 'Odisha'], ['Guwahati', '781', 'Assam'], ['Dibrugarh', '786', 'Assam'],
  ['Silchar', '788', 'Assam'], ['Jorhat', '785', 'Assam'], ['Shillong', '793', 'Meghalaya'],
  ['Imphal', '795', 'Manipur'], ['Agartala', '799', 'Tripura'], ['Aizawl', '796', 'Mizoram'],
  ['Kohima', '797', 'Nagaland'], ['Itanagar', '791', 'Arunachal Pradesh'], ['Gangtok', '737', 'Sikkim'],
  ['Siliguri', '734', 'West Bengal'], ['Durgapur', '713', 'West Bengal'], ['Howrah', '711', 'West Bengal'],
  ['Kharagpur', '721', 'West Bengal'], ['Port Blair', '744', 'Andaman and Nicobar Islands'],
  ['Visakhapatnam', '530', 'Andhra Pradesh'], ['Vijayawada', '520', 'Andhra Pradesh'], ['Guntur', '522', 'Andhra Pradesh'],
  ['Tirupati', '517', 'Andhra Pradesh'], ['Nellore', '524', 'Andhra Pradesh'], ['Kakinada', '533', 'Andhra Pradesh'],
  ['Kurnool', '518', 'Andhra Pradesh'], ['Warangal', '506', 'Telangana'], ['Karimnagar', '505', 'Telangana'],
  ['Nizamabad', '503', 'Telangana'], ['Khammam', '507', 'Telangana'], ['Mysuru', '570', 'Karnataka'],
  ['Mangaluru', '575', 'Karnataka'], ['Hubballi', '580', 'Karnataka'], ['Belagavi', '590', 'Karnataka'],
  ['Kalaburagi', '585', 'Karnataka'], ['Davanagere', '577', 'Karnataka'], ['Ballari', '583', 'Karnataka'],
  ['Udupi', '576', 'Karnataka'], ['Coimbatore', '641', 'Tamil Nadu'], ['Madurai', '625', 'Tamil Nadu'],
  ['Tiruchirappalli', '620', 'Tamil Nadu'], ['Salem', '636', 'Tamil Nadu'], ['Tirunelveli', '627', 'Tamil Nadu'],
  ['Vellore', '632', 'Tamil Nadu'], ['Thanjavur', '613', 'Tamil Nadu'], ['Erode', '638', 'Tamil Nadu'],
  ['Puducherry', '605', 'Puducherry'], ['Thiruvananthapuram', '695', 'Kerala'], ['Kozhikode', '673', 'Kerala'],
  ['Thrissur', '680', 'Kerala'], ['Kannur', '670', 'Kerala'], ['Kollam', '691', 'Kerala'],
  ['Palakkad', '678', 'Kerala'], ['Kottayam', '686', 'Kerala'], ['Alappuzha', '688', 'Kerala'],
];

const ZONES = 100;

/** Five platform slabs per zone: three standard weight bands and two express. */
function ratesFor(zoneId: string, far: boolean, createdAt: Date): Array<Record<string, unknown>> {
  const base = far ? 20 : 0;
  const slab = (method: string, minWeightGrams: number, maxWeightGrams: number, price: number, estimatedDays: number, freeShippingThreshold: number | null) => ({
    id: id(), zoneId, vendorId: null, method, minWeightGrams, maxWeightGrams, price: price + base,
    estimatedDays: estimatedDays + (far ? 2 : 0), freeShippingThreshold, createdAt, updatedAt: createdAt,
  });
  return [
    slab('STANDARD', 0, 1000, 49, 5, 499),
    slab('STANDARD', 1000, 5000, 79, 6, 999),
    slab('STANDARD', 5000, 15000, 129, 7, null),
    slab('EXPRESS', 0, 2000, 99, 2, 1499),
    slab('EXPRESS', 2000, 8000, 179, 3, null),
  ];
}

/** States far from the main warehouses ship slower and cost a little more. */
const FAR_STATES = new Set(['Assam', 'Meghalaya', 'Manipur', 'Tripura', 'Mizoram', 'Nagaland', 'Arunachal Pradesh', 'Sikkim', 'Jammu and Kashmir', 'Ladakh', 'Andaman and Nicobar Islands']);

export async function seedShipping(): Promise<void> {
  const taken = await select<{ p: string }>(
    `SELECT DISTINCT left(pincode, 3) AS p FROM addresses
     UNION SELECT DISTINCT left(pincode, 3) FROM vendors WHERE pincode IS NOT NULL
     UNION SELECT DISTINCT unnest("pincodePrefixes") FROM shipping_zones`,
  );
  const used = new Set(taken.map((row) => row.p));
  const regions = REGIONS.filter(([, prefix]) => !used.has(prefix) && used.add(prefix)).slice(0, ZONES);
  const zones: Array<Record<string, unknown>> = [];
  const rates: Array<Record<string, unknown>> = [];
  for (const [city, prefix, state] of regions) {
    const createdAt = daysAgo(int(200, 700));
    const zoneId = id();
    zones.push({ id: zoneId, name: `${city} (${state})`, states: pgArray([state]), pincodePrefixes: pgArray([prefix]), createdAt, updatedAt: createdAt });
    rates.push(...ratesFor(zoneId, FAR_STATES.has(state), createdAt));
  }
  await insert('shipping_zones', zones);
  await insert('shipping_rates', rates);
}
