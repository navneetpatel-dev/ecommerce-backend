'use strict';

/**
 * Long, realistic shopper text for exercising "Read more" clamping. Lengths are
 * picked to stay inside the posting limits (UGC_LIMITS): review body ≤ 2000,
 * question ≤ 300, answer ≤ 1000, review title ≤ 100.
 */
const REVIEW_PARAGRAPHS = [
  'I spent almost two weeks comparing this with three similar listings before ordering, mostly because the reviews elsewhere were mixed on durability. It arrived a day earlier than promised, packed in a sturdy box with enough padding that nothing rattled, and the invoice was tucked inside.',
  'First impressions were good. The finish is even, there are no loose threads or rough edges, and the colour is very close to the photos — maybe half a shade warmer under indoor lighting. The size matched the chart exactly, which is not something I can say for most things I buy online.',
  'After daily use for about a month, it still looks almost new. I have washed it twice following the care label and it has not shrunk or faded. The stitching around the stress points is reinforced, which you can actually see if you look closely, and it shows in how it has held up.',
  'A couple of small gripes: the instructions could be clearer, and the packaging uses more plastic than it needs to. Neither is a deal breaker, but if the seller is reading this, a simple recyclable sleeve would be an easy improvement and would make the unboxing feel more premium.',
  'Customer support was genuinely helpful when I had a question about the warranty. They replied within a few hours, explained what is covered and what is not, and did not try to push an extended plan. That kind of straightforward service is a big reason I would order from this seller again.',
  'Compared with the cheaper option I bought last year, this feels noticeably more solid. It is a little heavier, but that weight comes from better materials, and you can tell the difference the moment you pick it up. For the price difference, I think it is worth it if you plan to use it every day.',
  'My family has started borrowing it, which is probably the best review I can give. My sister ended up ordering one for herself after trying mine for a weekend, and she is just as happy with it. We both agree it is one of the better purchases we have made this year.',
  'If you are on the fence, check the size chart carefully and read the care instructions before the first wash. Do that, and I think you will be as pleased as I am. I am knocking off a star only for the packaging and the slightly vague instructions — the product itself is excellent.',
];

const LONG_REVIEW_TITLES = [
  'Better than I expected after a month of daily use — solid build and true to size',
  'Great quality for the price, with a couple of small packaging gripes worth knowing about',
  'Compared three similar listings and this one was clearly the best made of the lot',
  'Held up well through weeks of use and two washes; support was helpful with warranty',
];

const LONG_QUESTIONS = [
  'I usually wear a size between medium and large and my shoulders are on the broader side. Would you recommend sizing up, or does this run generous enough that my usual size will be comfortable for daily wear over a light layer?',
  'Is this suitable for use outdoors during the monsoon? I travel a lot for work and need something that will hold up to heavy rain and humidity without the material warping, fading or developing a smell after a few weeks of use.',
  'Does the warranty cover accidental damage or only manufacturing defects? And if something does go wrong within the first year, do I need to ship it back to the seller myself or will someone arrange a pickup from my address?',
  'How does this compare with the previous version that was sold here last year? I owned that one and the clasp broke after about eight months, so I want to know whether the design or the materials have actually changed since then.',
  'Can this be used comfortably by someone with sensitive skin? I react to some synthetic materials and certain dyes, so I would really appreciate it if anyone who has similar issues could share how it felt after a full day of use.',
  'What is the exact weight and the dimensions once it is unpacked? The listing gives the shipping size, but I need to know whether it will fit in the small cabin bag I carry on short flights without taking up most of the space.',
];

const ANSWER_PARAGRAPHS = [
  'I had exactly the same question before ordering, so here is what I found after using it for about six weeks.',
  'In short, yes — but with one caveat. It handles everyday use without any trouble, and I have not noticed any wear on the edges or the finish so far, even though I am not particularly careful with my things.',
  'Where it struggles a little is in very humid weather. After a couple of days of heavy rain it took longer to dry than I expected, though it did not develop any smell and the colour has not changed at all.',
  'On sizing, I went with my usual size and it fits well, but my brother, who is broader in the shoulders, sized up and was happier with that. If you are between sizes, I would lean towards the larger one.',
  'The seller was responsive when I asked about the warranty: manufacturing defects are covered for a year, and they arrange the pickup themselves, so you do not have to find a courier or pay for the return shipping.',
  'Overall I would buy it again, and I have already recommended it to two friends. Just read the care label before the first wash and you should be fine.',
];

module.exports = { REVIEW_PARAGRAPHS, LONG_REVIEW_TITLES, LONG_QUESTIONS, ANSWER_PARAGRAPHS };
