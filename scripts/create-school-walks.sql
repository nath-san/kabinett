-- ============================================================
-- SCHOOL WALKS 20-28: Nya skolwalks för alla kampanjer
-- ============================================================

-- Walk 20: Färg och känsla (NM, åk 7-9, Bild)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (20, 'farg-och-kansla', 'Färg och känsla', 'Hur konstnärer använder färg för att skapa stämning', 
'Impressionisterna sprängde alla regler för hur färg "skulle" användas. I den här vandringen utforskar vi hur konstnärer från Renoir till Zorn använde färg för att uttrycka känslor, ljus och rörelse. Perfekt för att diskutera färglära och komposition.',
'#C84B31', 'nationalmuseum', 1, 'school', 'åk 7-9',
'Bild: Färg, form och komposition. Analysera och tolka bilder. Kulturarv och bildtraditioner.',
'Titta noga på färgerna i varje verk. Vilken känsla förmedlar de? Hur hade bilden känt sig annorlunda med helt andra färger?',
datetime('now'));

-- Walk 21: Stormaktstiden i konsten (NM, åk 7-9, Historia)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (21, 'stormaktstiden', 'Stormaktstiden i konsten', 'Sveriges guldålder genom måleri och porträtt',
'Under 1600-talet var Sverige en europeisk stormakt. Kungarna lät måla sig i full prakt, slagfält förevigades och palatsen fylldes med konst. Upptäck hur konsten användes som propaganda och maktmedel.',
'#2C3E50', 'nationalmuseum', 1, 'school', 'åk 7-9',
'Historia: Nordens och Östersjöområdets historia. Hur historia kan användas för att förstå samtiden. Makt, samhälle och kultur.',
'Kungar och drottningar beställde porträtt för att visa sin makt. Tänk på det när ni tittar — vad vill konstnären att vi ska tänka om personen i bilden?',
datetime('now'));

-- Walk 22: Medeltid i föremål (SHM, åk 4-6, Historia)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (22, 'medeltid-i-foremal', 'Medeltid i föremål', 'Vardagsliv och makt under medeltiden',
'Hur levde man under medeltiden? Genom mynt, smycken, vapen och vardagsföremål kan vi få en bild av hur livet såg ut för både kungar och vanligt folk. Föremålen berättar historier som inga texter gör.',
'#5D4037', 'shm', 1, 'school', 'åk 4-6',
'Historia: Nordens kulturmöten, migration och levnadsvillkor. Hur historiska källor kan tolkas. Tidsbegreppet.',
'Alla dessa föremål har hittats i svensk jord. Någon har hållit dem i handen, burit dem, använt dem. Vem tror ni att det var?',
datetime('now'));

-- Walk 23: Makt och symboler (SHM, åk 7-9, Samhällskunskap/Historia)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (23, 'makt-och-symboler', 'Makt och symboler', 'Hur kungar visade sin makt genom föremål',
'Kronor, svärd, rustningar och kröningsregalier — alla berättar om makt. I den här vandringen utforskar vi hur Sveriges regenter använde föremål och symboler för att legitimera sitt styre. Vad säger en krona egentligen?',
'#B8860B', 'shm', 1, 'school', 'åk 7-9',
'Historia: Maktstrukturer och samhällsförändringar. Samhällskunskap: Demokrati och politiska system. Symbolers betydelse i samhället.',
'Makt har alltid visats genom symboler — förr var det kronor och svärd, idag kanske det är andra saker. Vilka maktsymboler ser ni i er vardag?',
datetime('now'));

-- Walk 24: Hantverk genom tiderna (Nordiska, åk 4-6, Slöjd/Bild)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (24, 'hantverk-genom-tiderna', 'Hantverk genom tiderna', 'Textil, trä och silver — med händernas kraft',
'Långt innan fabriker och maskiner skapade människor vackra och funktionella föremål för hand. Utforska folkdräkter, silversmide, träsnideri och textilkonst från hela Sverige. Vad kan vi lära oss av gårdagens hantverkare?',
'#8B4513', 'nordiska', 1, 'school', 'åk 4-6',
'Slöjd: Hantverk och materialval. Bild: Formgivning och design. Historia: Vardagsliv i Norden.',
'Varje föremål här har gjorts för hand, ibland under hundratals timmar. Fundera på skillnaden mellan dessa och saker ni köper i affären idag.',
datetime('now'));

-- Walk 25: Migration och möten (Nordiska, åk 7-9, Samhällskunskap)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (25, 'migration-och-moten', 'Migration och möten', 'Kulturmöten som format Sverige',
'Sverige har alltid formats av möten mellan kulturer — genom handel, invandring och utbyte. Nordiska museets samlingar visar spår av valloner, samer, romer och andra grupper som bidragit till det svenska samhället.',
'#1A5276', 'nordiska', 1, 'school', 'åk 7-9',
'Samhällskunskap: Migration och integration. Historia: Kulturmöten och Sveriges befolkningshistoria. Svenska: Läsa, tolka och reflektera.',
'Varje föremål här berättar om ett möte mellan kulturer. Vilka spår av andra kulturer kan ni hitta i ert eget vardagsliv?',
datetime('now'));

-- Walk 26: Djur i konsten (default/kabinett, åk 4-6, Bild)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (26, 'djur-i-konsten', 'Djur i konsten', 'Från Liljefors harar till vikingarnas drakar',
'Djur har fascinerat konstnärer i alla tider — från bronsålderns hällristningar till Bruno Liljefors naturskildringar. I den här vandringen möter ni djur i måleri, skulptur och hantverk från tre olika museer.',
'#2E7D32', 'default', 1, 'school', 'åk 4-6',
'Bild: Avbilda och uttrycka. Biologi: Djur och natur. Svenska: Beskrivande texter.',
'Konstnärer har avbildat djur i tusentals år. Men varför? Ibland för att visa naturens skönhet, ibland som symboler. Kan ni gissa vad djuret betyder i varje bild?',
datetime('now'));

-- Walk 27: Porträtt — ansikten genom historien (default/kabinett, åk 7-9, Bild/Historia)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (27, 'portratt-genom-historien', 'Porträtt — ansikten genom historien', 'Varför målade man porträtt och vad berättar de?',
'Innan kameran fanns var porträttmåleri det enda sättet att föreviga en person. Men porträtt handlar om mer än utseende — de berättar om makt, status, ideal och identitet. Jämför porträtt från renässansen till 1900-talet.',
'#6A1B9A', 'default', 1, 'school', 'åk 7-9',
'Bild: Porträttets uttryck och funktion. Historia: Samhällsförändringar genom tiderna. Svenska: Analysera och argumentera.',
'Tänk på porträttet som en slags selfie från förr. Men till skillnad från selfies tog varje porträtt veckor eller månader att måla. Vad säger det om hur viktigt det var?',
datetime('now'));

-- Walk 28: Sverige i landskapet (default/kabinett, åk 4-6, Bild/Geografi)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (28, 'sverige-i-landskapet', 'Sverige i landskapet', 'Fjäll, skärgård och skogar i konsten',
'Svenska konstnärer har i århundraden fångat vårt lands natur — från Carl Fredrik Hills böljande landskap till fotografier av Lapplands fjällvärld. Upptäck hur konstnärerna såg Sverige och jämför med hur det ser ut idag.',
'#1B5E20', 'default', 1, 'school', 'åk 4-6',
'Bild: Landskapsmåleri och komposition. Geografi: Sveriges landskap och natur. Svenska: Beskriva och jämföra.',
'Hur ser Sverige ut? Det beror på vem man frågar och vilken tid man lever i. Konstnärerna i den här vandringen ger alla olika svar.',
datetime('now'));

-- ============================================================
-- WALK ITEMS
-- ============================================================

-- Walk 20: Färg och känsla (NM) — 10 verk
-- Renoir
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(20, 19486, 1, 'Renoirs "La Grenouillère" fångar sommarljuset vid Seinen med snabba penseldrag och reflektioner i vattnet. Impressionismen handlade om att fånga ögonblicket — inte måla "korrekt".', 'Vilken tid på dagen tror ni det är? Hur kan ni se det på färgerna?'),
(20, 18761, 2, 'I "Ung parisiska" arbetar Renoir med varma hudtoner mot en mjuk bakgrund. Ansiktet lyser nästan inifrån.', 'Vilka färger dominerar? Vad gör det för känsla?'),
(20, 19139, 3, 'Renoirs "Konversation" visar hur ljus och skugga skapar djup utan hårda konturer. Färgerna flyter in i varandra.', 'Jämför med ett foto — vad är annorlunda med hur ljuset fungerar här?');
-- Monet
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(20, 19182, 4, 'Monet målade havet om och om igen, men aldrig likadant. I "Utsikt över havet" fångar han en specifik stämning — ett exakt ögonblick av ljus och vatten.', 'Om ni skulle måla havet — vilka färger skulle ni välja? Varför?'),
(20, 19574, 5, 'I "Motiv från Voorzaan" ser vi Monets tidiga stil — redan här experimenterar han med hur vatten reflekterar himlen.', 'Kan ni hitta platser där himlen och vattnet har samma färg?');
-- Zorn
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(20, 18693, 6, 'Anders Zorn målade ofta med bara fyra färger: svart, vitt, gult ockra och kadmiumrött. Ändå skapade han otroligt rika bilder. "Vid Siljan" visar hans behärskning av begränsad palett.', 'Kan ni se att bilden egentligen bara har fyra grundfärger? Var hittar ni dem?'),
(20, 24125, 7, 'Zorns "Vårt dagliga bröd" visar vardagsliv i Dalarna med akvarellens genomskinlighet — ljuset kommer genom färgen istället för att studsa på den.', 'Vad är skillnaden mellan akvarell och oljefärg? Kan ni se det här?');
-- Josephson
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(20, 18809, 8, 'Ernst Josephsons "David och Saul" använder dramatiska kontraster mellan ljus och mörker. Den bibliska scenen känns nästan som teater.', 'Var i bilden dras era ögon först? Varför tror ni det?'),
(20, 19282, 9, 'I "Byskvaller" fångar Josephson en vardagsscen med en värme som påminner om holländskt måleri, men med en friare penselföring.', 'Vilken stämning har bilden? Är det en glad eller allvarlig scen?');
-- Nordström
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(20, 18532, 10, 'Karl Nordströms "Hoga dal på Tjörn" visar Bohusläns karga landskap i starka, förenklade färger. Han var en av Sveriges första nationalromantiker.', 'Vilka känslor väcker landskapet? Är det vackert, ensamt, kraftfullt?');


-- Walk 21: Stormaktstiden (NM) — 10 verk
-- Behöver hitta rätt verk
