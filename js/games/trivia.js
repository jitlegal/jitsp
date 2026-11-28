// Gentle Trivia — a game plug-in for the family games shell (see GAMES.md).
// Multiple choice, no timers, kind feedback and a short fact after every answer. Original question bank.
// Deterministic: recipe { g:'trivia', s:seed, n:length, t:topic } always gives the same quiz.
// Question ids are topic code + position: only APPEND to a topic list, never reorder or delete (saves use ids).

const TOPICS = [
  ['nature', 'na', 'Nature & Animals'], ['geo', 'ge', 'Geography'], ['body', 'bo', 'Body & Health'],
  ['food', 'fo', 'Food & Cooking'], ['music', 'mu', 'Music'], ['invent', 'in', 'Inventions'],
  ['space', 'sp', 'Space & Weather'], ['words', 'wo', 'Language & Words'], ['sports', 'sg', 'Sports & Games'],
  ['history', 'hi', 'History'], ['garden', 'ga', 'Gardening'],
];
// [level, question, correct, wrong1, wrong2, wrong3, fact]
const RAW = {
  nature: [
    [1, 'What is a baby kangaroo called?', 'A joey', 'A cub', 'A kit', 'A calf', 'A newborn joey is about the size of a jelly bean and crawls straight into its mother’s pouch.'],
    [1, 'How many legs does a spider have?', 'Eight', 'Six', 'Ten', 'Twelve', 'Insects have six legs, so spiders are not insects — they are arachnids.'],
    [2, 'What is the largest animal that has ever lived?', 'The blue whale', 'The African elephant', 'The whale shark', 'The brachiosaurus', 'Blue whales can grow to around 30 metres (about 100 feet) long.'],
    [2, 'How many hearts does an octopus have?', 'Three', 'One', 'Two', 'Four', 'Two hearts pump blood to the gills and the third pumps it around the rest of the body.'],
    [1, 'Which is the tallest animal in the world?', 'The giraffe', 'The elephant', 'The camel', 'The ostrich', 'A giraffe’s long neck has just seven bones — the same number as a human neck.'],
    [1, 'What is the fastest land animal?', 'The cheetah', 'The lion', 'The horse', 'The greyhound', 'In short bursts a cheetah can run at around 100 km/h (over 60 mph).'],
    [3, 'What colour is a polar bear’s skin, under its fur?', 'Black', 'White', 'Pink', 'Yellow', 'Dark skin helps a polar bear soak up warmth from the sun.'],
    [1, 'What is a young frog called?', 'A tadpole', 'A cub', 'A duckling', 'A kitten', 'Tadpoles breathe with gills, then grow legs and lungs as they become frogs.'],
    [2, 'Which is the only mammal that can truly fly, not just glide?', 'The bat', 'The flying squirrel', 'The sugar glider', 'The hedgehog', 'Flying squirrels and sugar gliders only glide — bats flap their wings to fly.'],
    [2, 'About how long is an elephant’s pregnancy?', 'About 22 months', 'About 9 months', 'About 12 months', 'About 4 years', 'African elephants have the longest pregnancy of any land mammal.'],
    [3, 'What is a male duck called?', 'A drake', 'A gander', 'A cob', 'A cockerel', 'A male goose is a gander and a male swan is a cob.'],
    [2, 'What is a female sheep called?', 'A ewe', 'A doe', 'A sow', 'A mare', 'A male sheep is called a ram, and a baby sheep is a lamb.'],
    [2, 'Which living bird lays the largest eggs?', 'The ostrich', 'The emu', 'The eagle', 'The swan', 'One ostrich egg weighs about as much as two dozen hen’s eggs.'],
    [1, 'What do giant pandas mostly eat?', 'Bamboo', 'Fish', 'Eucalyptus leaves', 'Berries', 'A giant panda can spend 10 to 16 hours a day eating.'],
    [2, 'What word describes animals that are active at night?', 'Nocturnal', 'Migratory', 'Dormant', 'Domestic', 'Owls, hedgehogs and bats are all nocturnal.'],
    [3, 'What is a baby swan called?', 'A cygnet', 'A gosling', 'A duckling', 'An eaglet', 'Cygnets are usually grey-brown and turn white as they grow up.'],
    [2, 'Koalas mainly eat the leaves of which tree?', 'Eucalyptus', 'Bamboo', 'Oak', 'Pine', 'Eucalyptus leaves give little energy, so koalas sleep for most of the day.'],
  ],
  geo: [
    [1, 'What is the capital of France?', 'Paris', 'Lyon', 'Marseille', 'Nice', 'The Eiffel Tower was built for the 1889 World’s Fair in Paris.'],
    [1, 'Which is the largest ocean?', 'The Pacific', 'The Atlantic', 'The Indian', 'The Arctic', 'The Pacific Ocean covers about a third of the Earth’s surface.'],
    [2, 'Which is the longest river in Africa?', 'The Nile', 'The Congo', 'The Niger', 'The Zambezi', 'The Nile flows north and empties into the Mediterranean Sea.'],
    [1, 'In which country are the pyramids of Giza?', 'Egypt', 'Mexico', 'Jordan', 'Morocco', 'The Great Pyramid was the tallest building made by people for over 3,800 years.'],
    [2, 'Which European country is shaped like a boot?', 'Italy', 'Greece', 'Spain', 'Portugal', 'The island of Sicily sits just off the “toe” of the boot.'],
    [2, 'What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth', 'Canberra was purpose-built as a compromise between Sydney and Melbourne.'],
    [1, 'Which river flows through London?', 'The Thames', 'The Severn', 'The Seine', 'The Shannon', 'Tower Bridge, which crosses the Thames, opened in 1894.'],
    [2, 'Which mountain range runs down the west side of South America?', 'The Andes', 'The Alps', 'The Rockies', 'The Himalayas', 'The Andes is the longest mountain range on land in the world.'],
    [3, 'What is the capital of Canada?', 'Ottawa', 'Toronto', 'Montreal', 'Vancouver', 'Queen Victoria chose Ottawa as the capital in 1857.'],
    [2, 'Which country is famous for tulips, windmills and canals?', 'The Netherlands', 'Belgium', 'Denmark', 'Switzerland', 'Tulips first reached the Netherlands from the Ottoman Empire in the late 1500s.'],
    [2, 'What is the largest island in the world, not counting Australia?', 'Greenland', 'Madagascar', 'Borneo', 'Iceland', 'Despite its name, most of Greenland is covered in ice.'],
    [2, 'In which country is the city of Rio de Janeiro?', 'Brazil', 'Argentina', 'Portugal', 'Mexico', 'The official language of Brazil is Portuguese.'],
    [3, 'Which sea is so salty that people float in it easily?', 'The Dead Sea', 'The Red Sea', 'The Black Sea', 'The North Sea', 'The shore of the Dead Sea is the lowest dry land on Earth.'],
    [3, 'In which country is Mount Kilimanjaro?', 'Tanzania', 'Kenya', 'Uganda', 'Ethiopia', 'Kilimanjaro is the highest mountain in Africa.'],
    [2, 'Which is the smallest country in the world?', 'Vatican City', 'Monaco', 'San Marino', 'Liechtenstein', 'Vatican City lies inside Rome and is home to the Pope.'],
    [2, 'Which imaginary line divides the Earth into northern and southern halves?', 'The equator', 'The Tropic of Cancer', 'The Prime Meridian', 'The Arctic Circle', 'At the equator, day and night are each about 12 hours long all year round.'],
  ],
  body: [
    [1, 'How many bones are in the adult human body?', '206', '106', '156', '306', 'Babies are born with nearly 300 bones, and some join together as they grow.'],
    [1, 'Which organ pumps blood around the body?', 'The heart', 'The lungs', 'The liver', 'The kidneys', 'An adult heart beats about 100,000 times a day.'],
    [2, 'What is the largest organ of the human body?', 'The skin', 'The liver', 'The brain', 'The lungs', 'The outer layer of your skin renews itself every few weeks.'],
    [2, 'Where is the smallest bone in the body?', 'In the ear', 'In the toe', 'In the finger', 'In the nose', 'It is called the stirrup, and it is about the size of a grain of rice.'],
    [2, 'Which vitamin does our skin make in sunlight?', 'Vitamin D', 'Vitamin A', 'Vitamin C', 'Vitamin K', 'Vitamin D helps the body take in calcium for strong bones.'],
    [2, 'Which vitamin, found in oranges, prevents scurvy?', 'Vitamin C', 'Vitamin A', 'Vitamin D', 'Vitamin K', 'Sailors once carried lemons and limes on long voyages to prevent scurvy.'],
    [2, 'What joins muscles to bones?', 'Tendons', 'Ligaments', 'Cartilage', 'Veins', 'The Achilles tendon, at the back of the ankle, is the strongest tendon in the body.'],
    [2, 'Which organs filter the blood to make urine?', 'The kidneys', 'The lungs', 'The spleen', 'The stomach', 'Each kidney is about the size of a clenched fist.'],
    [2, 'What is the medical name for the kneecap?', 'Patella', 'Femur', 'Tibia', 'Scapula', 'The kneecap protects the front of the knee joint.'],
    [2, 'Which is the longest bone in the body?', 'The thigh bone (femur)', 'The shin bone (tibia)', 'The upper arm bone (humerus)', 'The collarbone', 'The thigh bone is roughly a quarter of a person’s height.'],
    [2, 'How many chambers does the human heart have?', 'Four', 'Two', 'Three', 'Six', 'The two upper chambers are the atria and the two lower ones are the ventricles.'],
    [3, 'What is the hardest substance in the human body?', 'Tooth enamel', 'Bone', 'Fingernails', 'Hair', 'Enamel cannot repair itself, which is why looking after teeth matters.'],
    [3, 'Which muscle under the lungs helps us breathe?', 'The diaphragm', 'The biceps', 'The hamstring', 'The calf muscle', 'Hiccups happen when the diaphragm suddenly twitches.'],
    [2, 'Which coloured part of the eye gives it its colour?', 'The iris', 'The pupil', 'The retina', 'The lens', 'The word “iris” comes from the Greek word for rainbow.'],
    [1, 'How many teeth does an adult usually have, including wisdom teeth?', '32', '24', '28', '36', 'Children have 20 baby teeth.'],
  ],
  food: [
    [1, 'What is the main ingredient of guacamole?', 'Avocado', 'Peas', 'Cucumber', 'Green pepper', 'Guacamole comes from Mexico, where avocados have been eaten for thousands of years.'],
    [2, 'Which spice gives many curries their yellow colour?', 'Turmeric', 'Paprika', 'Cinnamon', 'Nutmeg', 'Turmeric is a root related to ginger.'],
    [2, 'Which fruit is used to make traditional cider?', 'Apples', 'Pears', 'Grapes', 'Plums', 'A similar drink made from pears is called perry.'],
    [2, 'Which nut is used to make marzipan?', 'Almonds', 'Walnuts', 'Peanuts', 'Hazelnuts', 'Marzipan is made from ground almonds and sugar.'],
    [2, 'What is the main ingredient of hummus?', 'Chickpeas', 'Lentils', 'Kidney beans', 'Peas', 'Hummus is also made with tahini, a paste of sesame seeds.'],
    [1, 'At what temperature does water boil at sea level?', '100°C (212°F)', '80°C (176°F)', '90°C (194°F)', '120°C (248°F)', 'High up on a mountain, water boils at a lower temperature.'],
    [2, 'Which vegetable is used to make sauerkraut?', 'Cabbage', 'Lettuce', 'Onion', 'Cucumber', 'Sauerkraut is cabbage preserved by fermenting it.'],
    [2, 'Parmesan cheese first comes from which country?', 'Italy', 'France', 'Switzerland', 'Greece', 'True Parmigiano-Reggiano is aged for at least 12 months.'],
    [1, 'What does a baker add to dough to make bread rise?', 'Yeast', 'Salt', 'Vinegar', 'Pepper', 'Yeast is a tiny living fungus that gives off gas bubbles as it feeds.'],
    [2, 'Which fruit is dried to make raisins?', 'Grapes', 'Plums', 'Apricots', 'Figs', 'Dried plums are called prunes.'],
    [3, 'What is the green paste often served with sushi?', 'Wasabi', 'Miso', 'Tofu', 'Teriyaki', 'Much “wasabi” sold outside Japan is really horseradish coloured green.'],
    [2, 'Classic pesto is made mainly with which herb?', 'Basil', 'Parsley', 'Mint', 'Coriander', 'Classic pesto comes from Genoa and also uses pine nuts, garlic and cheese.'],
    [2, 'What is tofu made from?', 'Soya beans', 'Rice', 'Chickpeas', 'Wheat', 'Tofu is made by curdling soya milk, a little like making cheese.'],
    [2, 'Peach Melba was named after what kind of performer?', 'An opera singer', 'A ballet dancer', 'A circus clown', 'A violinist', 'The dessert was created by the French chef Auguste Escoffier for the soprano Nellie Melba.'],
    [2, 'Where were potatoes first farmed?', 'South America', 'Ireland', 'Africa', 'Asia', 'Potatoes were first farmed in the Andes mountains thousands of years ago.'],
    [2, 'Which fruit carries its seeds on the outside?', 'The strawberry', 'The blueberry', 'The cherry', 'The grape', 'An average strawberry has about 200 seeds on its skin.'],
  ],
  music: [
    [1, 'How many keys are on a standard modern piano?', '88', '66', '76', '100', 'There are 52 white keys and 36 black keys.'],
    [1, 'How many strings does a violin have?', 'Four', 'Three', 'Five', 'Six', 'The violin is the smallest and highest-sounding of the violin family.'],
    [1, 'How many strings does a standard guitar have?', 'Six', 'Four', 'Five', 'Eight', 'Bass guitars usually have four strings.'],
    [2, 'Which composer kept writing music after he went deaf?', 'Beethoven', 'Mozart', 'Bach', 'Handel', 'Beethoven’s Ninth Symphony was first performed when he was almost completely deaf.'],
    [2, 'What is a group of four musicians called?', 'A quartet', 'A trio', 'A quintet', 'A duet', 'A string quartet has two violins, a viola and a cello.'],
    [2, 'In which city was Mozart born?', 'Salzburg', 'Vienna', 'Prague', 'Berlin', 'Mozart wrote his first pieces of music when he was about five years old.'],
    [2, 'Which brass instrument uses a long slide to change notes?', 'The trombone', 'The trumpet', 'The tuba', 'The French horn', 'An early form of the trombone was called the sackbut.'],
    [2, 'Which instrument is named after its inventor, Adolphe Sax?', 'The saxophone', 'The clarinet', 'The oboe', 'The trumpet', 'Although it is made of brass, the saxophone is a woodwind because it uses a reed.'],
    [2, 'In music, what does “forte” mean?', 'Loud', 'Soft', 'Fast', 'Slow', '“Piano” means soft, so the pianoforte is the “soft-loud” instrument.'],
    [2, 'Who composed “The Four Seasons”?', 'Vivaldi', 'Bach', 'Handel', 'Haydn', 'Antonio Vivaldi was a priest, nicknamed “the Red Priest” for his red hair.'],
    [2, 'Which singer was known as “the King of Rock and Roll”?', 'Elvis Presley', 'Chuck Berry', 'Buddy Holly', 'Little Richard', 'Elvis was born in Tupelo, Mississippi, in 1935.'],
    [3, 'Who composed the music for the ballet “The Nutcracker”?', 'Tchaikovsky', 'Stravinsky', 'Prokofiev', 'Rachmaninoff', 'The Nutcracker was first performed in St Petersburg in 1892.'],
    [2, 'Which composer of piano music was born in Poland?', 'Chopin', 'Liszt', 'Schubert', 'Grieg', 'Frédéric Chopin spent much of his adult life in Paris.'],
    [2, 'What is the highest female singing voice called?', 'Soprano', 'Alto', 'Tenor', 'Bass', 'The lower female voice is called alto.'],
    [3, 'Who composed “Messiah”, with its famous “Hallelujah” chorus?', 'Handel', 'Bach', 'Haydn', 'Mozart', 'Audiences traditionally stand up for the Hallelujah chorus.'],
    [2, 'Which instrument did Louis Armstrong famously play?', 'The trumpet', 'The saxophone', 'The clarinet', 'The piano', 'He was also loved for his warm, gravelly singing voice.'],
  ],
  invent: [
    [2, 'Who received the first US patent for the telephone, in 1876?', 'Alexander Graham Bell', 'Thomas Edison', 'Guglielmo Marconi', 'Samuel Morse', 'Bell’s first words on it were reportedly “Mr. Watson, come here, I want to see you.”'],
    [2, 'Who invented the World Wide Web?', 'Tim Berners-Lee', 'Bill Gates', 'Steve Jobs', 'Alan Turing', 'He proposed it in 1989 while working at CERN, near Geneva.'],
    [1, 'Who made the first powered aeroplane flight, in 1903?', 'The Wright brothers', 'The Montgolfier brothers', 'Louis Blériot', 'Charles Lindbergh', 'The very first flight lasted about 12 seconds.'],
    [2, 'Who discovered penicillin in 1928?', 'Alexander Fleming', 'Louis Pasteur', 'Marie Curie', 'Edward Jenner', 'He noticed mould killing germs on a dish he had left out.'],
    [2, 'Who made the first vaccine, against smallpox?', 'Edward Jenner', 'Louis Pasteur', 'Alexander Fleming', 'Joseph Lister', 'The word “vaccine” comes from the Latin word for cow, because Jenner used cowpox.'],
    [1, 'What did Louis Braille invent?', 'A reading system for blind people', 'A sewing machine', 'A camera', 'A telescope', 'He was only 15 when he worked out his system of raised dots.'],
    [2, 'Who showed an early television to an audience in London in 1926?', 'John Logie Baird', 'Guglielmo Marconi', 'Alexander Graham Bell', 'Thomas Edison', 'John Logie Baird was a Scottish engineer.'],
    [2, 'What did Alfred Nobel invent?', 'Dynamite', 'The steam engine', 'The light bulb', 'The radio', 'Nobel left his fortune to create the Nobel Prizes.'],
    [2, 'Which instrument did Galileo improve to study the night sky?', 'The telescope', 'The microscope', 'The compass', 'The barometer', 'In 1610 he discovered four moons circling Jupiter.'],
    [2, 'What did Percy Spencer invent after a chocolate bar melted in his pocket?', 'The microwave oven', 'The refrigerator', 'The toaster', 'The dishwasher', 'He noticed it while working with radar equipment in the 1940s.'],
    [2, 'Who flew the first hot-air balloon to carry people, in 1783?', 'The Montgolfier brothers', 'The Wright brothers', 'The Lumière brothers', 'The Grimm brothers', 'Before people, the first passengers were a sheep, a duck and a rooster.'],
    [2, 'Which tool helps travellers find north using a magnetised needle?', 'A compass', 'A sextant', 'A telescope', 'An anchor', 'Magnetic compasses were used in China over a thousand years ago.'],
    [3, 'What did Percy Shaw invent in 1934 to help drivers at night?', 'Cat’s eyes road reflectors', 'Traffic lights', 'Windscreen wipers', 'Speed bumps', 'He was said to be inspired by light shining back from a cat’s eyes.'],
    [2, 'What did Wilhelm Röntgen discover in 1895?', 'X-rays', 'Ultrasound', 'Radio waves', 'Electricity', 'He won the very first Nobel Prize in Physics, in 1901.'],
    [2, 'What did László Bíró patent in the 1930s?', 'The ballpoint pen', 'The fountain pen', 'The pencil sharpener', 'The typewriter', 'In many countries a ballpoint pen is still called a “biro”.'],
    [1, 'Which American flew a kite in a thunderstorm to study electricity?', 'Benjamin Franklin', 'Thomas Edison', 'George Washington', 'Abraham Lincoln', 'Franklin went on to invent the lightning rod to protect buildings.'],
  ],
  space: [
    [1, 'Which planet is known as the Red Planet?', 'Mars', 'Jupiter', 'Venus', 'Mercury', 'Mars looks red because of rusty iron in its dust.'],
    [2, 'Which is the closest star to Earth?', 'The Sun', 'The North Star', 'Sirius', 'Betelgeuse', 'Sunlight takes about 8 minutes to reach Earth.'],
    [1, 'Who was the first person to walk on the Moon?', 'Neil Armstrong', 'Buzz Aldrin', 'Yuri Gagarin', 'John Glenn', 'Apollo 11 landed on the Moon in July 1969.'],
    [2, 'Which is the largest planet in our solar system?', 'Jupiter', 'Saturn', 'Neptune', 'Earth', 'More than 1,000 Earths could fit inside Jupiter.'],
    [1, 'Which planet is famous for its bright rings?', 'Saturn', 'Mars', 'Venus', 'Mercury', 'Saturn’s rings are made mostly of chunks of ice.'],
    [2, 'Who was the first person in space, in 1961?', 'Yuri Gagarin', 'Neil Armstrong', 'John Glenn', 'Alan Shepard', 'His flight went once around the Earth and lasted about 108 minutes.'],
    [2, 'Which planet is closest to the Sun?', 'Mercury', 'Venus', 'Mars', 'Earth', 'A year on Mercury lasts only 88 Earth days.'],
    [2, 'What causes the sound of thunder?', 'Lightning heating the air very quickly', 'Clouds bumping together', 'Rain hitting the ground', 'Wind blowing over hills', 'Count the seconds after the flash: about 3 seconds is roughly 1 kilometre away.'],
    [2, 'What does a barometer measure?', 'Air pressure', 'Temperature', 'Wind speed', 'Rainfall', 'Falling air pressure often means wet or stormy weather is on its way.'],
    [2, 'Which gas makes up most of the air we breathe?', 'Nitrogen', 'Oxygen', 'Carbon dioxide', 'Hydrogen', 'Air is about 78% nitrogen and 21% oxygen.'],
    [2, 'What is the name of our galaxy?', 'The Milky Way', 'Andromeda', 'Orion', 'The Whirlpool', 'On a dark night away from towns, it looks like a pale band across the sky.'],
    [2, 'Which colour is on the outside edge of a rainbow?', 'Red', 'Violet', 'Green', 'Blue', 'To see a rainbow, the sun must be behind you and the rain in front of you.'],
    [2, 'Which is the hottest planet in our solar system?', 'Venus', 'Mercury', 'Mars', 'Jupiter', 'Venus’s thick clouds trap heat, so it is hotter than Mercury even though Mercury is closer to the Sun.'],
    [2, 'What does the Moon’s pull on the oceans cause?', 'The tides', 'Earthquakes', 'Rain', 'Wind', 'Many coasts have two high tides and two low tides every day.'],
    [2, 'What does a “light year” measure?', 'Distance', 'Time', 'Brightness', 'Weight', 'It is how far light travels in a year — nearly 10 trillion kilometres.'],
    [3, 'Which planet spins tipped over on its side?', 'Uranus', 'Neptune', 'Saturn', 'Mars', 'Uranus is tilted over by about 98 degrees.'],
  ],
  words: [
    [1, 'What is a word that means the same as another word?', 'A synonym', 'An antonym', 'An acronym', 'A pronoun', '“Happy” and “glad” are synonyms.'],
    [1, 'What is a word that means the opposite of another word?', 'An antonym', 'A synonym', 'A homophone', 'A pronoun', '“Hot” and “cold” are antonyms.'],
    [1, 'How many letters are in the English alphabet?', '26', '24', '28', '30', 'The letter E is the most commonly used letter in English.'],
    [2, 'What is a word that reads the same backwards, like “level”?', 'A palindrome', 'An anagram', 'An acronym', 'A homophone', '“Noon” and “racecar” are palindromes too.'],
    [2, 'Which language gives us the word “kindergarten”?', 'German', 'Dutch', 'French', 'Swedish', 'It means “children’s garden”.'],
    [2, 'What does the start “bi-” mean, as in “bicycle”?', 'Two', 'One', 'Three', 'Many', '“Tri-” means three, as in tricycle.'],
    [2, 'Which spelling is correct?', 'Necessary', 'Neccessary', 'Necesary', 'Neccesary', 'A memory trick: a shirt has one collar and two sleeves — one C and two S’s.'],
    [2, '“As busy as a bee” is an example of what?', 'A simile', 'A rhyme', 'A pun', 'A palindrome', 'A simile compares two things using “like” or “as”.'],
    [2, 'What does “RSVP” on an invitation ask you to do?', 'Reply', 'Bring a gift', 'Dress smartly', 'Arrive early', 'It stands for the French “répondez s’il vous plaît” — “please reply”.'],
    [3, 'What is a person who loves books called?', 'A bibliophile', 'A philatelist', 'A numismatist', 'An audiophile', 'A philatelist collects stamps and a numismatist collects coins.'],
    [2, 'Which letter is silent in the word “knee”?', 'K', 'N', 'The first E', 'The last E', 'Hundreds of years ago, the K in words like “knee” and “knight” was spoken.'],
    [2, 'A short story with animals that teaches a lesson is called a what?', 'A fable', 'A sonnet', 'A limerick', 'A ballad', 'Many famous fables are credited to Aesop of ancient Greece.'],
    [2, 'How many lines does a traditional sonnet have?', '14', '10', '12', '16', 'William Shakespeare wrote 154 sonnets.'],
    [2, 'Which word means a fear of spiders?', 'Arachnophobia', 'Claustrophobia', 'Acrophobia', 'Agoraphobia', 'Claustrophobia is a fear of small, enclosed spaces.'],
    [1, 'If a task is “a piece of cake”, it is…', 'Very easy', 'Very sweet', 'Very small', 'Very expensive', 'Sayings whose meaning differs from their words are called idioms.'],
    [2, 'What does “et cetera” (etc.) mean?', 'And the rest', 'For example', 'That is to say', 'Please note', '“E.g.” is short for the Latin “exempli gratia”, meaning “for the sake of example”.'],
  ],
  sports: [
    [1, 'How many players does a football (soccer) team have on the field?', '11', '9', '10', '12', 'That number includes the goalkeeper.'],
    [2, 'In tennis, what is a score of zero called?', 'Love', 'Nil', 'Duck', 'Blank', 'Nobody knows for certain where this use of “love” came from.'],
    [1, 'How many holes are in a standard round of golf?', '18', '9', '12', '21', 'The Old Course at St Andrews helped make 18 holes the standard.'],
    [2, 'How many rings are on the Olympic flag?', 'Five', 'Four', 'Six', 'Seven', 'The modern Olympic Games began in Athens in 1896.'],
    [1, 'In which sport do you score a “try”?', 'Rugby', 'Cricket', 'Golf', 'Tennis', 'Rugby takes its name from Rugby School in England.'],
    [2, 'In ten-pin bowling, what is it called when you knock all the pins down with your first ball?', 'A strike', 'A spare', 'A split', 'A gutter', 'A perfect game is 12 strikes in a row, for a score of 300.'],
    [2, 'In snooker, which ball is worth the most points?', 'The black', 'The pink', 'The blue', 'A red', 'The black is worth seven points, the pink six and the blue five.'],
    [2, 'Which sport is played at Wimbledon?', 'Tennis', 'Golf', 'Cricket', 'Polo', 'Wimbledon is the oldest tennis tournament in the world, first held in 1877.'],
    [2, 'In golf, what is a score of one under par called?', 'A birdie', 'An eagle', 'A bogey', 'A hole in one', 'An eagle is two under par, and a bogey is one over.'],
    [2, 'In which sport do players hit a feathered shuttlecock?', 'Badminton', 'Squash', 'Table tennis', 'Lacrosse', 'A traditional shuttlecock has 16 feathers.'],
    [2, 'How many squares are on a chessboard?', '64', '36', '48', '100', 'Each player starts the game with 16 pieces.'],
    [2, 'In chess, which piece moves only diagonally?', 'The bishop', 'The rook', 'The knight', 'The king', 'Each player has two bishops — one on light squares and one on dark.'],
    [2, 'In which sport do players slide stones across ice while others sweep?', 'Curling', 'Ice hockey', 'Bobsleigh', 'Figure skating', 'Sweeping helps the stone travel further and straighter.'],
    [2, 'What is the highest score possible with three darts?', '180', '150', '160', '200', 'Three darts in the treble 20 score 60 each.'],
    [2, 'Which country did the sport of judo come from?', 'Japan', 'China', 'Korea', 'Thailand', 'Judo was created by Kano Jigoro in 1882.'],
    [2, 'The Tour de France is a famous race in which sport?', 'Cycling', 'Running', 'Sailing', 'Motor racing', 'The Tour de France was first held in 1903.'],
  ],
  history: [
    [1, 'In which year did the Second World War end?', '1945', '1939', '1944', '1950', 'The war in Europe ended in May 1945, and in the Pacific later that summer.'],
    [1, 'Who was the first President of the United States?', 'George Washington', 'Abraham Lincoln', 'Thomas Jefferson', 'John Adams', 'The city of Washington, D.C. is named after him.'],
    [2, 'In which year did the Berlin Wall fall?', '1989', '1979', '1985', '1991', 'Germany was reunited less than a year later, in October 1990.'],
    [2, 'In which year did Columbus first sail to the Americas?', '1492', '1066', '1588', '1620', 'His voyage was paid for by Queen Isabella and King Ferdinand of Spain.'],
    [1, 'Which famous ship sank on its first voyage in 1912?', 'The Titanic', 'The Lusitania', 'The Mary Rose', 'The Bismarck', 'The Titanic struck an iceberg in the North Atlantic.'],
    [2, 'Who was the British Prime Minister for most of the Second World War?', 'Winston Churchill', 'Neville Chamberlain', 'Clement Attlee', 'Anthony Eden', 'Churchill also won the Nobel Prize in Literature in 1953.'],
    [2, 'In which year was the Battle of Hastings?', '1066', '1215', '1415', '1666', 'The Bayeux Tapestry tells the story of the battle.'],
    [2, 'Who was known as “the Lady with the Lamp”?', 'Florence Nightingale', 'Edith Cavell', 'Clara Barton', 'Grace Darling', 'She founded a school for nurses in London in 1860.'],
    [2, 'Which document did King John agree to in 1215?', 'Magna Carta', 'The Domesday Book', 'The Bill of Rights', 'The Treaty of Versailles', 'Magna Carta is Latin for “Great Charter”.'],
    [1, 'Who painted the Mona Lisa?', 'Leonardo da Vinci', 'Michelangelo', 'Raphael', 'Botticelli', 'The Mona Lisa hangs in the Louvre in Paris.'],
    [2, 'Which people built Machu Picchu?', 'The Inca', 'The Aztecs', 'The Maya', 'The Olmecs', 'It sits high in the Andes mountains of Peru.'],
    [2, 'Who was the first woman to win a Nobel Prize?', 'Marie Curie', 'Florence Nightingale', 'Rosalind Franklin', 'Ada Lovelace', 'She is the only person to win Nobel Prizes in two different sciences: physics and chemistry.'],
    [2, 'Whose tomb did Howard Carter find in Egypt in 1922?', 'Tutankhamun', 'Ramesses II', 'Cleopatra', 'Khufu', 'Tutankhamun became king when he was only about nine years old.'],
    [2, 'In which year did the Great Fire of London happen?', '1666', '1066', '1566', '1766', 'The fire started in a bakery on Pudding Lane.'],
    [2, 'Which country gave the Statue of Liberty to the United States?', 'France', 'Britain', 'Spain', 'Italy', 'It was dedicated in New York Harbor in 1886.'],
    [2, 'Which Roman town was buried by Mount Vesuvius in AD 79?', 'Pompeii', 'Rome', 'Athens', 'Naples', 'The ash preserved the town so well that visitors can walk its streets today.'],
    [2, 'Who led the first expedition to reach the South Pole, in 1911?', 'Roald Amundsen', 'Robert Falcon Scott', 'Ernest Shackleton', 'Edmund Hillary', 'Amundsen’s team arrived about five weeks before Captain Scott’s.'],
  ],
  garden: [
    [1, 'What do bees collect from flowers to make honey?', 'Nectar', 'Sap', 'Seeds', 'Dew', 'As they visit flowers, bees also carry pollen, which helps plants make seeds.'],
    [2, 'What is the process plants use to make food from sunlight?', 'Photosynthesis', 'Pollination', 'Germination', 'Evaporation', 'Chlorophyll, the green colour in leaves, captures the light.'],
    [2, 'What are plants that come back year after year called?', 'Perennials', 'Annuals', 'Biennials', 'Seedlings', 'Annuals grow, flower and die all in one year.'],
    [2, 'What does “deadheading” mean in the garden?', 'Removing faded flowers', 'Mowing the lawn', 'Pulling up weeds', 'Digging out roots', 'Deadheading often encourages a plant to make more flowers.'],
    [2, 'Which beetle is a gardener’s friend because it eats aphids?', 'The ladybird (ladybug)', 'The cockchafer', 'The weevil', 'The lily beetle', 'One ladybird can eat thousands of aphids in its lifetime.'],
    [2, 'Which flower is worn to remember those who died in war?', 'The poppy', 'The rose', 'The lily', 'The daisy', 'The custom comes from the poem “In Flanders Fields”, written in 1915.'],
    [2, 'Which spring flower with a trumpet shape grows from a bulb planted in autumn?', 'The daffodil', 'The sunflower', 'The sweet pea', 'The marigold', 'The daffodil is a national emblem of Wales.'],
    [2, 'Which long-handled tool with a flat blade is used to cut weeds at soil level?', 'A hoe', 'A rake', 'A trowel', 'Shears', 'Hoeing works best on a dry day, so the cut weeds wither in the sun.'],
    [1, 'Which part of a plant takes up water from the soil?', 'The roots', 'The leaves', 'The petals', 'The flowers', 'Water travels up from the roots to the leaves through tiny tubes.'],
    [3, 'What colour do many hydrangea flowers turn in acid soil?', 'Blue', 'Pink', 'White', 'Yellow', 'In chalky, alkaline soil, many hydrangeas turn pink instead.'],
    [1, 'Which tree grows acorns?', 'The oak', 'The beech', 'The ash', 'The willow', 'Many oaks do not grow acorns until they are about 20 years old or more.'],
    [2, 'Which tall flower turns to follow the sun while it is young?', 'The sunflower', 'The daisy', 'The tulip', 'The rose', 'Once fully grown, most sunflower heads stay facing east.'],
    [2, 'Which creature improves soil by tunnelling and eating dead leaves?', 'The earthworm', 'The slug', 'The greenfly', 'The wasp', 'Charles Darwin wrote a whole book about earthworms.'],
    [2, 'What is cutting back branches to shape a plant called?', 'Pruning', 'Weeding', 'Sowing', 'Mulching', 'Many roses are pruned in late winter or early spring.'],
    [3, 'Tomatoes belong to the same plant family as which vegetable?', 'Potatoes', 'Carrots', 'Onions', 'Cabbages', 'Botanically, a tomato is a fruit because it holds seeds.'],
    [2, 'Which plant grows “hips”, small red fruits rich in vitamin C?', 'The rose', 'The holly', 'The tulip', 'The ivy', 'Rose hips are used to make syrups and jams.'],
  ],
};

const TOPIC = new Map(TOPICS.map(([id, code, name]) => [id, { id, code, name }]));
const BANK = [];
for (const [id, code] of TOPICS) RAW[id].forEach(([level, q, a, w1, w2, w3, fact], i) => BANK.push({ id: code + (i + 1), topic: id, level, q, a, w: [w1, w2, w3], fact }));
const BY_ID = new Map(BANK.map(x => [x.id, x]));
const LENGTHS = [5, 10, 15];

function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const hash = s => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/** The questions of a round, as ids. 'any' mixes topics round-robin, then goes gentle → harder. */
function pick(recipe) {
  const r = rng((recipe.s ^ hash(recipe.t + '|' + recipe.n)) >>> 0);
  let ids;
  if (recipe.t === 'any') {
    const lists = shuffle(TOPICS.map(([id]) => shuffle(BANK.filter(x => x.topic === id), r)), r);
    ids = []; for (let k = 0; ids.length < recipe.n; k++) { const L = lists[k % lists.length]; const x = L[Math.floor(k / lists.length)]; if (x) ids.push(x); }
  } else ids = shuffle(BANK.filter(x => x.topic === recipe.t), r).slice(0, recipe.n);
  return ids.map((x, i) => [x, i]).sort((p, q) => p[0].level - q[0].level || p[1] - q[1]).map(p => p[0].id);
}
/** Options in shown order and the two wrong ones 50:50 removes — both fixed by seed + question. */
function layout(s, id) {
  const x = BY_ID.get(id), r = rng((s ^ hash(id)) >>> 0);
  const opts = shuffle([x.a, ...x.w], r), wrong = shuffle([0, 1, 2, 3].filter(i => opts[i] !== x.a), r);
  return { x, opts, right: opts.indexOf(x.a), gone: wrong.slice(0, 2) };
}
const cheer = (c, n) => c === n ? 'A perfect score — brilliant!' : c >= n * 0.7 ? 'Splendid work!' : c >= n * 0.4 ? 'Well played — and lots of new things learned!' : 'Every question teaches something new — lovely effort!';
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let instances = 0;

class Trivia {
  constructor(host, hooks = {}) {
    this.host = host; this.hooks = hooks; this.ns = `tv${++instances}`;
    this.root = el('div', 'tv'); this.root.setAttribute('role', 'region'); this.root.setAttribute('aria-label', 'Trivia quiz');
    this.card = el('div', 'tv-card'); this.root.append(this.card);
    if (!hooks.announce) { this.live = el('div', 'tv-sr'); this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite'); this.root.append(this.live); }
    this.onKey = e => this._key(e); this.root.addEventListener('keydown', this.onKey);
    this.root.addEventListener('pointerdown', () => hooks.onTouch?.());
    host.append(this.root);
  }
  async load(recipe, { state } = {}) {
    this.recipe = recipe; this.ids = pick(recipe); this.a = []; this.h = []; this.c = 0; this.fin = false;
    if (state && typeof state === 'object') {
      const q = state.q;
      if (Array.isArray(q) && q.length === recipe.n && q.every(i => BY_ID.has(i)) && new Set(q).size === q.length) this.ids = q.slice();
      if (Array.isArray(state.a)) for (const v of state.a.slice(0, this.ids.length)) { if (Number.isInteger(v) && v >= 0 && v < 4) this.a.push(v); else break; }
      if (Array.isArray(state.h)) this.h = [...new Set(state.h.filter(i => Number.isInteger(i) && i >= 0 && i < this.ids.length))];
      const c = state.c; this.c = Number.isInteger(c) && (c === this.a.length || c === this.a.length - 1) ? c : Math.min(this.a.length, this.ids.length - 1);
      if (this.c >= this.ids.length) this.c = this.ids.length - 1;
      this.fin = state.f === 1 && this.a.length === this.ids.length;
    }
    this._render(); this._progress();
  }
  state() { return { v: 1, q: this.ids.slice(), a: this.a.slice(), h: this.h.slice(), c: this.c, f: this.fin ? 1 : 0 }; }
  progress() { return { done: this.a.length, total: this.ids ? this.ids.length : 0 }; }
  get done() { return this.fin; }
  correct() { return this.a.filter((v, i) => v === layout(this.recipe.s, this.ids[i]).right).length; }
  stats() { return { hints: this.h.length, correct: this.correct() }; }
  resize() {}
  destroy() { this.root.removeEventListener('keydown', this.onKey); this.root.remove(); }

  help() {
    if (this.fin || !this.ids) return;
    if (this.c < this.a.length) { this._say('This question is answered. Choose “Next” to carry on.'); return; }
    if (this.h.includes(this.c)) { this._say('50:50 is already used for this question — two answers are left.'); return; }
    this.h.push(this.c); this._render(true);
    this._say('50:50 — two wrong answers have been taken away. Two answers are left.');
    this.hooks.onChange?.();
  }
  choose(i) {
    if (this.fin || this.c < this.a.length) return;
    const L = layout(this.recipe.s, this.ids[this.c]);
    if (this.h.includes(this.c) && L.gone.includes(i)) return;
    this.a.push(i); const ok = i === L.right;
    if (ok) this.hooks.onPlace?.(this.a.length === this.ids.length);
    this._render(); this._say(ok ? `Correct! ${L.x.fact}` : `Not quite — it was ${L.x.a}. ${L.x.fact}`);
    this.result?.focus();
    this._progress(); this.hooks.onChange?.();
  }
  next() {
    if (this.fin || this.c >= this.a.length) return;
    if (this.c === this.ids.length - 1) { this.fin = true; this._render(); this.finHead?.focus(); this.hooks.onChange?.(); this.hooks.onComplete?.(); return; }
    this.c++; this._render(); this.qHead?.focus(); this.hooks.onChange?.();
  }

  _say(t) { if (this.hooks.announce) this.hooks.announce(t); else if (this.live) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = t; }, 50); } }
  _progress() { const p = this.progress(); this.hooks.onProgress?.(p.done, p.total); }
  _render(keepFocus) {
    this.result = this.qHead = this.finHead = null;
    if (this.fin) return this._renderFinish();
    const L = layout(this.recipe.s, this.ids[this.c]), answered = this.c < this.a.length, pickd = this.a[this.c], half = this.h.includes(this.c);
    const top = el('div', 'tv-top');
    top.append(el('p', 'tv-meta', `Question ${this.c + 1} of ${this.ids.length} · ${TOPIC.get(L.x.topic).name}`),
      el('p', 'tv-score', `⭐ ${this.correct()} right so far`));
    const qh = this.qHead = el('h2', 'tv-q', L.x.q); qh.id = `${this.ns}-q`; qh.tabIndex = -1;
    const keys = el('p', 'tv-sr', 'Press 1, 2, 3 or 4 to answer. H for 50:50.'); keys.id = `${this.ns}-k`;
    const grp = el('div', 'tv-answers'); grp.setAttribute('role', 'group'); grp.setAttribute('aria-labelledby', qh.id); grp.setAttribute('aria-describedby', keys.id);
    L.opts.forEach((o, i) => {
      const b = el('button', 'tv-ans'); b.type = 'button'; b.dataset.i = i;
      const gone = half && L.gone.includes(i) && !(answered && pickd === i);
      let mark = '';
      if (answered && i === L.right) { b.classList.add('is-right'); mark = i === pickd ? '✓ Your answer — right!' : '✓ Right answer'; }
      else if (answered && i === pickd) { b.classList.add('is-wrong'); mark = '✗ Your answer'; }
      else if (gone) { b.classList.add('is-gone'); mark = 'Taken away (50:50)'; }
      b.append(el('span', 'tv-num', String(i + 1)), el('span', 'tv-text', o));
      if (mark) b.append(el('span', 'tv-mark', mark));
      b.setAttribute('aria-label', `${i + 1}: ${o}${mark ? ` — ${mark}` : ''}`);
      if (answered || gone) b.setAttribute('aria-disabled', 'true');
      b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') this.choose(i); });
      grp.append(b);
    });
    const parts = [top, qh, keys, grp];
    if (answered) {
      const ok = pickd === L.right, res = this.result = el('div', 'tv-result ' + (ok ? 'ok' : 'no')); res.tabIndex = -1;
      res.append(el('p', 'tv-verdict', ok ? '✓ Correct!' : `✗ Not quite — it was ${L.x.a}.`), el('p', 'tv-fact', `Did you know? ${L.x.fact}`));
      const nx = el('button', 'tv-next primary', this.c === this.ids.length - 1 ? 'See my score ➜' : 'Next question ➜'); nx.type = 'button';
      nx.addEventListener('click', () => this.next()); res.append(nx); parts.push(res);
    } else {
      const f = el('button', 'tv-fifty', half ? '50:50 used for this question' : '½ 50:50 — take away two wrong answers'); f.type = 'button';
      if (half) f.setAttribute('aria-disabled', 'true');
      f.addEventListener('click', () => { if (!half) this.help(); }); parts.push(f);
    }
    const had = keepFocus && this.root.contains(document.activeElement);
    this.card.replaceChildren(...parts);
    if (had) grp.querySelector('.tv-ans:not([aria-disabled])')?.focus();
  }
  _renderFinish() {
    const n = this.ids.length, c = this.correct();
    const h = this.finHead = el('h2', 'tv-q tv-final', `You got ${c} out of ${n} right!`); h.tabIndex = -1;
    const list = el('ol', 'tv-review'); list.setAttribute('aria-label', 'Your answers');
    this.ids.forEach((id, i) => {
      const L = layout(this.recipe.s, id), ok = this.a[i] === L.right, li = el('li', ok ? 'ok' : 'no');
      li.append(el('span', 'tv-rmark', ok ? '✓ Right' : '✗ Not this time'), el('span', 'tv-rq', L.x.q), el('span', 'tv-ra', `Answer: ${L.x.a}`));
      list.append(li);
    });
    this.card.replaceChildren(el('p', 'tv-meta', `${TOPIC.get(this.recipe.t)?.name || 'A bit of everything'} · ${n} questions`), h, el('p', 'tv-cheer', cheer(c, n)), list);
  }
  _key(e) {
    if (!this.ids || this.fin || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key, answered = this.c < this.a.length;
    if (!answered && k >= '1' && k <= '4') { e.preventDefault(); this.choose(+k - 1); return; }
    if (!answered && (k === 'h' || k === 'H')) { e.preventDefault(); this.help(); return; }
    if (answered && (k === 'n' || k === 'N' || (k === 'Enter' && e.target === this.result))) { e.preventDefault(); this.next(); }
  }

  snapshot() {
    const W = 1200, H = 900, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d'), n = this.ids.length, c = this.correct();
    g.fillStyle = '#24463c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fbf4e6'; g.beginPath(); g.roundRect ? g.roundRect(60, 60, W - 120, H - 120, 40) : g.rect(60, 60, W - 120, H - 120); g.fill();
    g.fillStyle = '#2b2118'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 64px Georgia, serif'; g.fillText('❓ Gentle Trivia', W / 2, 170);
    g.font = '32px "Atkinson Hyperlegible", system-ui, sans-serif'; g.fillStyle = '#5a4a3a';
    g.fillText(`${TOPIC.get(this.recipe.t)?.name || 'A bit of everything'} · ${n} questions`, W / 2, 240);
    g.fillStyle = '#2b2118'; g.font = '700 120px "Atkinson Hyperlegible", system-ui, sans-serif'; g.fillText(`${c} out of ${n}`, W / 2, 400);
    const per = Math.min(5, n) === 5 && n > 5 ? Math.ceil(n / Math.ceil(n / 8)) : n, rows = Math.ceil(n / per), R = 34;
    this.ids.forEach((id, i) => {
      const ok = this.a[i] === layout(this.recipe.s, id).right, row = Math.floor(i / per), col = i % per, inRow = Math.min(per, n - row * per);
      const x = W / 2 + (col - (inRow - 1) / 2) * 90, y = 540 + row * 90 - (rows - 1) * 45;
      g.fillStyle = ok ? '#2e7d32' : '#c9b9a0'; g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = ok ? '#fff' : '#2b2118'; g.font = '700 40px system-ui, sans-serif'; g.fillText(ok ? '✓' : '✗', x, y + 2);
    });
    g.fillStyle = '#2b2118'; g.font = '600 44px Georgia, serif'; g.fillText(cheer(c, n), W / 2, 740);
    return cv;
  }
}

const trivia = {
  id: 'trivia', name: 'Trivia', emoji: '❓',
  blurb: 'Gentle quiz questions with a fun fact after each one',
  usesPicture: false, zoomable: false, noun: 'trivia quiz', unit: 'questions',
  tip: 'Tap the answer you think is right. 💡 Help takes away two wrong answers.',
  keys: 'Press 1, 2, 3 or 4 to answer, Enter or N for the next question, H for 50:50.',
  options: [
    { key: 'length', label: 'How many questions?', choices: [[5, '5 questions (quick)'], [10, '10 questions'], [15, '15 questions (a long one)']], default: 10 },
    { key: 'topic', label: 'Topic', choices: [['any', 'A bit of everything'], ...TOPICS.map(([id, , name]) => [id, name])], default: 'any' },
  ],
  newRecipe(seed, opts = {}) {
    const n = LENGTHS.includes(Number(opts.length)) ? Number(opts.length) : 10, t = TOPIC.has(opts.topic) ? opts.topic : 'any';
    return { g: 'trivia', s: (Number(seed) >>> 0) & 0x7fffffff, n, t };
  },
  normalize(r) {
    try {
      if (!r || typeof r !== 'object' || r.g !== 'trivia') return null;
      const { s, n, t } = r;
      if (!Number.isInteger(s) || s < 0 || s > 0x7fffffff) return null;
      if (!LENGTHS.includes(n)) return null;
      if (typeof t !== 'string' || (t !== 'any' && !TOPIC.has(t))) return null;
      return { g: 'trivia', s, n, t };
    } catch (_) { return null; }
  },
  title(r) { return `Trivia · ${TOPIC.get(r.t)?.name || 'Mixed'} ${1000 + (r.s % 9000)}`; },
  progressLabel(done, total) { return `${done} of ${total} answered`; },
  describe(r) { return `${r.n} questions · ${TOPIC.get(r.t)?.name || 'A bit of everything'}`; },
  finishText(r, seconds, stats = {}) {
    const c = stats.correct || 0, h = stats.hints || 0;
    return `You got ${c} out of ${r.n} right${h ? `, using 50:50 ${h} time${h === 1 ? '' : 's'}` : ''}! ${cheer(c, r.n)}`;
  },
  create(host, hooks) { return new Trivia(host, hooks); },
  _internal: { BANK, TOPICS, pick, layout },
};
export default trivia;
