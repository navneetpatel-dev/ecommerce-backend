'use strict';

/**
 * Deterministic copy for the review / Q&A demo seed. Everything is driven by a
 * seeded PRNG so re-running produces the same text for the same product.
 */

/** mulberry32 — tiny deterministic PRNG. */
function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (product id → seed). */
function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const between = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));

/** Realistic, positively skewed star mix. */
function pickRating(rng) {
  const roll = rng();
  if (roll < 0.46) return 5;
  if (roll < 0.74) return 4;
  if (roll < 0.87) return 3;
  if (roll < 0.94) return 2;
  return 1;
}

const TITLES = {
  5: ['Absolutely love it', 'Exceeded expectations', 'Worth every rupee', 'Brilliant quality', 'Five stars, no doubt', 'Would buy again', 'Better than the photos'],
  4: ['Really good', 'Very happy overall', 'Solid purchase', 'Good value for money', 'Nice, with one small gripe', 'Does the job well'],
  3: ['Okay product', 'Decent, not great', 'Average experience', 'Mixed feelings', 'Fine for the price'],
  2: ['Expected more', 'Not quite as described', 'Below average', 'Disappointed'],
  1: ['Would not recommend', 'Poor quality', 'Not worth it', 'Very disappointed'],
};

const OPENERS = {
  5: ['Ordered the {name} after a lot of comparison and it is exactly what I wanted.', 'The {name} arrived well packed and the quality is excellent.', 'Been using the {name} for a few weeks now and I am really impressed.'],
  4: ['The {name} is good quality and matches the description.', 'Happy with the {name} overall.', 'Using the {name} daily and it holds up nicely.'],
  3: ['The {name} is okay for the price.', 'The {name} works as advertised but nothing extraordinary.', 'Mixed experience with the {name}.'],
  2: ['The {name} did not quite live up to the listing.', 'Expected better finishing on the {name}.', 'The {name} feels cheaper than it looks in the photos.'],
  1: ['The {name} was a letdown.', 'Unfortunately the {name} did not work out for me.', 'Quality of the {name} is well below what was promised.'],
};

const DETAILS = {
  positive: ['Build quality feels premium.', 'Colour is true to the pictures.', 'Delivery was quicker than estimated.', 'Packaging was neat and secure.', 'Fits perfectly into my daily routine.', 'Great attention to detail.', 'Gifted one to a friend and they loved it too.'],
  neutral: ['Delivery took a little longer than expected.', 'Instructions could have been clearer.', 'Size runs slightly small, so check the chart.', 'Packaging was basic but did the job.', 'The finish is good but not perfect.'],
  negative: ['Stitching came loose within a week.', 'Colour looked different in person.', 'Material feels thin.', 'Box arrived slightly damaged.', 'Took a long time to arrive.'],
};

const CLOSERS = {
  5: ['Highly recommended.', 'Will definitely order again from this seller.', 'Go for it!'],
  4: ['Would recommend.', 'Good buy overall.', 'Happy with the purchase.'],
  3: ['Fine if your expectations are modest.', 'Okay for occasional use.', 'Might look at alternatives next time.'],
  2: ['Would think twice before buying again.', 'Hoping the seller improves this.'],
  1: ['Returning it.', 'Not buying this again.'],
};

const VENDOR_RESPONSES = {
  positive: ['Thank you so much for the kind words! We are glad you enjoyed it.', 'Thanks for shopping with us. Reviews like yours make our day!'],
  negative: ['We are sorry this did not meet expectations. Please raise a ticket and we will make it right.', 'Thanks for the honest feedback. Our team has shared this with quality control.'],
};

function buildReview(rng, productName) {
  const rating = pickRating(rng);
  const name = productName.length > 60 ? `${productName.slice(0, 57)}...` : productName;
  const tone = rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative';
  const detailCount = between(rng, 1, 3);
  const details = [];
  for (let i = 0; i < detailCount; i += 1) {
    const detail = pick(rng, DETAILS[tone]);
    if (!details.includes(detail)) details.push(detail);
  }
  const body = [pick(rng, OPENERS[rating]).replace('{name}', name), ...details, pick(rng, CLOSERS[rating])].join(' ');
  const helpfulCount = Math.floor(rng() ** 2.2 * 60);
  const vendorResponse =
    rng() < (rating <= 2 ? 0.35 : 0.08) ? pick(rng, VENDOR_RESPONSES[rating <= 2 ? 'negative' : 'positive']) : null;
  return {
    rating,
    title: rng() < 0.9 ? pick(rng, TITLES[rating]) : null,
    body,
    helpfulCount,
    unhelpfulCount: Math.floor(rng() ** 3 * 8),
    vendorResponse,
  };
}

const CITIES = ['Pune', 'Bengaluru', 'Jaipur', 'Kochi', 'Lucknow', 'Indore', 'Guwahati', 'Chandigarh', 'Nagpur', 'Surat'];
const USES = ['daily use', 'travel', 'gifting', 'office', 'outdoor use', 'kids', 'a small apartment'];

const QUESTIONS = [
  ['Is this suitable for {use}?', ['Yes, it works really well for {use}.', 'I use it for {use} and it has been great.', 'It is fine for {use}, though a bit bulky.']],
  ['How long does delivery take to {city}?', ['It reached {city} in about 4 days for me.', 'Usually 3–5 working days to {city}.', 'Took a week to {city} during the sale.']],
  ['Does it come with a warranty?', ['Yes, the seller offers a 6-month warranty against manufacturing defects.', 'There is a standard 1-year warranty card in the box.']],
  ['Is the colour the same as in the photos?', ['Very close to the photos, maybe a shade lighter.', 'Yes, exactly as shown.', 'Slightly darker in person.']],
  ['Can this be returned if it does not fit?', ['Yes, returns are accepted within the return window shown on the page.', 'I exchanged mine without any issue.']],
  ['What is the material quality like?', ['Feels sturdy and well made.', 'Good for the price, not premium.', 'Material is thick and durable.']],
  ['Is it easy to clean?', ['A damp cloth is enough.', 'Yes, very low maintenance.', 'Hand wash recommended.']],
  ['Does the size run true?', ['True to size for me.', 'Runs slightly small, go one size up.', 'Fits as per the size chart.']],
  ['Is gift wrapping available?', ['Yes, you can choose gift wrap at checkout.', 'I ordered it gift wrapped and it looked lovely.']],
  ['How is the packaging?', ['Securely packed with bubble wrap.', 'Came in a sturdy branded box.']],
  ['Is this original / genuine?', ['Yes, sold directly by the brand seller with an invoice.', 'Genuine product, came with a tax invoice.']],
  ['Is assembly required?', ['No assembly needed, ready to use out of the box.', 'Minimal assembly, took about 10 minutes.']],
  ['Can I get it in a different variant?', ['Check the variant selector above, a few options are listed.', 'The seller restocks other variants every few weeks.']],
  ['Is it worth the price?', ['Absolutely, great value.', 'Yes, especially during offers.', 'Decent value, nothing exceptional.']],
  ['How heavy is it?', ['Quite light, easy to carry around.', 'Moderately heavy but manageable.']],
];

function buildQuestion(rng) {
  const [template, answers] = pick(rng, QUESTIONS);
  const city = pick(rng, CITIES);
  const use = pick(rng, USES);
  const fill = (text) => text.replace('{city}', city).replace('{use}', use);
  return { question: fill(template), answers: answers.map(fill) };
}

module.exports = { createRng, hashString, pick, between, buildReview, buildQuestion };
