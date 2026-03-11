-- ============================================================
-- SCHOOL WALKS 20-25: 2 nya per museum (6 totalt)
-- Befintliga: 17 (NM), 18 (SHM), 19 (Nordiska)
-- ============================================================

-- Walk 20: Färg och känsla (NM, åk 7-9, Bild)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (20, 'farg-och-kansla', 'Färg och känsla', 'Hur konstnärer använder färg för att skapa stämning',
'Impressionisterna sprängde alla regler för hur färg "skulle" användas. I den här vandringen utforskar vi hur konstnärer från Renoir till Zorn använde färg för att uttrycka känslor, ljus och rörelse.',
'#C84B31', 'nationalmuseum', 1, 'school', 'åk 7-9',
'Bild: Färg, form och komposition. Analysera och tolka bilder.',
'Titta noga på färgerna i varje verk. Vilken känsla förmedlar de? Hur hade bilden känt sig annorlunda med helt andra färger?',
datetime('now'));

-- Walk 21: Stormaktstiden i konsten (NM, åk 7-9, Historia)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (21, 'stormaktstiden', 'Stormaktstiden i konsten', 'Sveriges guldålder genom måleri och porträtt',
'Under 1600-talet var Sverige en europeisk stormakt. Kungarna lät måla sig i full prakt, slagfält förevigades och palatsen fylldes med konst. Upptäck hur konsten användes som propaganda och maktmedel.',
'#2C3E50', 'nationalmuseum', 1, 'school', 'åk 7-9',
'Historia: Nordens och Östersjöområdets historia. Makt, samhälle och kultur.',
'Kungar och drottningar beställde porträtt för att visa sin makt. Tänk på det när ni tittar — vad vill konstnären att vi ska tänka om personen i bilden?',
datetime('now'));

-- Walk 22: Medeltid i föremål (SHM, åk 4-6, Historia)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (22, 'medeltid-i-foremal', 'Medeltid i föremål', 'Vardagsliv och makt under medeltiden',
'Hur levde man under medeltiden? Genom smycken, vapen och kyrkokonst kan vi få en bild av hur livet såg ut. Föremålen berättar historier som inga texter gör.',
'#5D4037', 'shm', 1, 'school', 'åk 4-6',
'Historia: Nordens kulturmöten och levnadsvillkor. Hur historiska källor kan tolkas.',
'Alla dessa föremål har hittats i svensk jord. Någon har hållit dem i handen, burit dem, använt dem. Vem tror ni att det var?',
datetime('now'));

-- Walk 23: Makt och symboler (SHM, åk 7-9, Historia/Samhällskunskap)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (23, 'makt-och-symboler', 'Makt och symboler', 'Hur kungar visade sin makt genom föremål',
'Kronor, svärd, rustningar och kröningsregalier — alla berättar om makt. Utforska hur Sveriges regenter använde föremål och symboler för att visa sitt styre.',
'#B8860B', 'shm', 1, 'school', 'åk 7-9',
'Historia: Maktstrukturer och samhällsförändringar. Samhällskunskap: Symbolers betydelse.',
'Makt har alltid visats genom symboler — förr var det kronor och svärd, idag kanske det är andra saker. Vilka maktsymboler ser ni i er vardag?',
datetime('now'));

-- Walk 24: Hantverk genom tiderna (Nordiska, åk 4-6, Slöjd/Bild)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (24, 'hantverk-genom-tiderna', 'Hantverk genom tiderna', 'Textil, trä och silver — med händernas kraft',
'Långt innan fabriker och maskiner skapade människor vackra föremål för hand. Utforska folkdräkter, silversmide och textilkonst från hela Sverige.',
'#8B4513', 'nordiska', 1, 'school', 'åk 4-6',
'Slöjd: Hantverk och materialval. Bild: Formgivning och design.',
'Varje föremål här har gjorts för hand, ibland under hundratals timmar. Fundera på skillnaden mellan dessa och saker ni köper i affären idag.',
datetime('now'));

-- Walk 25: Migration och möten (Nordiska, åk 7-9, Samhällskunskap)
INSERT INTO walks (id, slug, title, subtitle, description, color, campaign_id, published, type, target_grades, lgr22_references, discussion_intro, created_at)
VALUES (25, 'migration-och-moten', 'Migration och möten', 'Kulturmöten som format Sverige',
'Sverige har alltid formats av möten mellan kulturer — genom handel, invandring och utbyte. Nordiska museets samlingar visar spår av de människor som bidragit till det svenska samhället.',
'#1A5276', 'nordiska', 1, 'school', 'åk 7-9',
'Samhällskunskap: Migration och mångfald. Historia: Kulturmöten.',
'Varje föremål här berättar om ett möte mellan kulturer. Vilka spår av andra kulturer kan ni hitta i ert eget vardagsliv?',
datetime('now'));


-- ============================================================
-- WALK ITEMS
-- ============================================================

-- Walk 20: Färg och känsla (NM, åk 7-9) — 10 verk
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(20, 19486, 1, 'Renoirs "La Grenouillère" fångar sommarljuset vid Seinen med snabba penseldrag och reflektioner i vattnet. Impressionismen handlade om att fånga ögonblicket.', 'Vilken tid på dagen tror ni det är? Hur kan ni se det på färgerna?'),
(20, 18761, 2, 'I "Ung parisiska" arbetar Renoir med varma hudtoner mot en mjuk bakgrund. Ansiktet lyser nästan inifrån.', 'Vilka färger dominerar? Vad gör det för känsla?'),
(20, 19182, 3, 'Monet målade havet om och om igen. I "Utsikt över havet" fångar han en specifik stämning — ett exakt ögonblick av ljus och vatten.', 'Om ni skulle måla havet — vilka färger skulle ni välja?'),
(20, 19574, 4, 'Monets "Motiv från Voorzaan" visar hans tidiga stil — redan här experimenterar han med hur vatten reflekterar himlen.', 'Kan ni hitta platser där himlen och vattnet har samma färg?'),
(20, 18693, 5, 'Anders Zorn målade ofta med bara fyra färger: svart, vitt, gult ockra och kadmiumrött. "Vid Siljan" visar hans behärskning av en begränsad palett.', 'Kan ni se att bilden egentligen bara har fyra grundfärger? Var hittar ni dem?'),
(20, 24125, 6, 'Zorns "Vårt dagliga bröd" visar vardagsliv i Dalarna med akvarellens genomskinlighet — ljuset kommer genom färgen.', 'Vad är skillnaden mellan akvarell och oljefärg? Kan ni se det?'),
(20, 18809, 7, 'Josephsons "David och Saul" använder dramatiska kontraster mellan ljus och mörker. Den bibliska scenen känns som teater.', 'Var i bilden dras era ögon först? Varför?'),
(20, 19282, 8, 'I "Byskvaller" fångar Josephson en vardagsscen med värme som påminner om holländskt 1600-talsmåleri.', 'Vilken stämning har bilden? Glad eller allvarlig?'),
(20, 18532, 9, 'Karl Nordströms "Hoga dal på Tjörn" visar Bohusläns karga landskap i starka, förenklade färger. Han var en av de första nationalromantikerna.', 'Vilka känslor väcker landskapet? Vackert, ensamt, kraftfullt?'),
(20, 22575, 10, 'Berthe Morisots "I Boulognerskogen" visar en impressionistisk trädgårdsscen med lätta, snabba penseldrag. Morisot var en av få kvinnliga impressionister som fick erkännande.', 'Hur skiljer sig Morisots penselföring från de andra konstnärerna i vandringen?');

-- Walk 21: Stormaktstiden (NM, åk 7-9) — 10 verk
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(21, 15082, 1, 'Gustav II Adolf var "Lejonet från Norden" — kungen som gjorde Sverige till en stormakt. Det här porträttet visar honom som den allvarlige krigarkungen.', 'Hur vill konstnären att vi ska uppfatta kungen? Vilka detaljer visar det?'),
(21, 14894, 2, 'Ehrenstrahl målade kungafamiljen Karl XI med familj i fullt majestät. Han var hovmålare och hans uppdrag var att få kungafamiljen att se gudomlig ut.', 'Är det här ett realistiskt porträtt tror ni, eller smickrade konstnären?'),
(21, 14988, 3, 'Karl XII som litet barn — redan i barndomen porträtterad som framtida regent. Ehrenstrahl målade honom 1688, sex år gammal.', 'Varför tror ni att man målade kungabarn redan så tidigt?'),
(21, 14810, 4, '"Ryktet och Historien förkunnar Karl XI:s bedrifter" — ett allegoriskt måleri där mytologiska figurer hyllar kungen. Propaganda i ren form.', 'Vad är propaganda? Finns det liknande saker idag?'),
(21, 174862, 5, 'Ehrenstrahl förevigade Karl X Gustavs förmälning som en kosmisk händelse. Allegorin lyfter bröllopet till gudarnas nivå.', 'Varför använde man mytologiska figurer istället för att måla verkligheten?'),
(21, 15985, 6, 'Allegorin "Fidelitas" (trohet) av Ehrenstrahl visar hur abstrakta begrepp förvandlades till konst. Troheten mot kronan var central.', 'Hur skulle ni visa "trohet" i en bild?'),
(21, 177003, 7, 'Lemkes slagfältsmåleri visar Bohus belägring — ett ögonblick ur kriget fryst i färg. Dessa målningar fungerade som nyhetsrapportering.', 'Hur fick folk veta vad som hände i krig på 1600-talet? Jämför med idag.'),
(21, 176407, 8, 'En bataljscen av Lemke. Rök, hästar, soldater — den dramatiska verkligheten av 1600-talets krig.', 'Är krigskonst glorifierande eller avskräckande? Vad tycker ni?'),
(21, 15084, 9, 'Karl XII porträtterad av Wedekind 1719 — året efter kungens död vid Fredriksten. Ett postumt porträtt av hjältekonungen.', 'Varför fortsatte man måla porträtt av Karl XII efter hans död?'),
(21, 23935, 10, 'Carl Larssons monumentala "Gustav Vasas intåg i Stockholm 1523" — målat 1908 men föreställer 1500-talet. Larsson tolkade historien genom sin egen tids ögon.', 'Det här målades nästan 400 år efter händelsen. Hur påverkar det bildens trovärdighet?');

-- Walk 22: Medeltid i föremål (SHM, åk 4-6) — 10 verk
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(22, -281014433543789, 1, 'Ett altarskåp från medeltiden — kyrkornas mest värdefulla möbel. Inuti finns målade eller snidade scener ur Bibeln. Det här stod en gång i en svensk kyrka.', 'Varför var altarskåp så viktiga i medeltida kyrkor?'),
(22, -280300675320324, 2, 'En dopfunt i sten — här döptes barn för hundratals år sedan. Dopfuntar är bland de äldsta föremålen som fortfarande finns i svenska kyrkor.', 'Tror ni att den här dopfunten fortfarande används någonstans?'),
(22, -280863433366563, 3, 'Ett relikskrin — en liten kista som ansågs innehålla rester av ett helgon. Under medeltiden trodde man att relikerna hade magisk kraft.', 'Vad tror ni att folk bad om framför ett relikskrin?'),
(22, -280303043173749, 4, 'Ett relikkors som burits runt halsen. Kors var den vanligaste symbolen under medeltiden och bars av alla — från kungar till bönder.', 'Vilka symboler bär folk runt halsen idag? Varför?'),
(22, -279627492139784, 5, 'Ett processionskrucifix som bars framför i kyrkliga processioner. Hela byn samlades och gick genom gatorna bakom korset.', 'Finns det liknande traditioner idag där folk samlas och går tillsammans?'),
(22, -279693821891758, 6, 'Ett pilgrimsmärke — ett bevis på att man gjort en pilgrimsvandring. Medeltida resenärer gick hundratals mil till heliga platser och köpte märken som souvenirer.', 'Samlar ni på något som bevisar att ni varit på en plats? Magneter, pins?'),
(22, -281452078341829, 7, 'En sigillstamp i metall — medeltidens underskrift. Bara viktiga personer hade sigill, och det trycktes i vax på dokument.', 'Hur bevisar vi vår identitet idag? Jämför med sigillet.'),
(22, -281376364432224, 8, 'Ytterligare en sigillstamp med annan design. Varje sigill var unikt — att förfalska någons sigill var ett allvarligt brott.', 'Varför var det så viktigt att sigillet var unikt?'),
(22, -279824287703983, 9, 'Viklaumadonnan — en av Gotlands mest kända medeltida träskulpturer. Maria med Jesusbarnet, snidat och målat i starka färger.', 'Skulpturer var oftast målade i starka färger på medeltiden. Hur förändrar det er bild av "gammal konst"?'),
(22, -279760761245308, 10, 'Ännu ett altarskåp — det här med öppningsbara dörrar. På vardagar var dörrarna stängda, men på söndagar och högtider öppnades de och visade scenerna inuti.', 'Varför visade man bara insidan på helgerna? Vad säger det om hur man tänkte om konst?');

-- Walk 23: Makt och symboler (SHM, åk 7-9) — 10 verk
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(23, -281427951285964, 1, 'Drottning Kristinas kröningsmantel — buren vid Sveriges mest berömda kröning 1650. En mantel av guld och purpur som symboliserade kunglig makt.', 'Varför var kläder så viktiga för att visa makt?'),
(23, -281245604647156, 2, 'En kröningsdräkt — speciellt tillverkad för den enda gången den skulle bäras. Kröningen var den viktigaste dagen i en kungs liv.', 'Finns det klädkoder idag som visar status? Ge exempel.'),
(23, -281238685453888, 3, 'En krona buren av kronprinsessan Margareta vid Edvard VII:s kröning i London 1902. Nordiska kungahus deltog i varandras ceremonier.', 'Vad symboliserar en krona? Varför just den formen?'),
(23, -280931074839124, 4, 'Ett baner tillverkat för Johan Gabriel Stenbock till Karl X Gustavs kröning 1654. Adeln bar sina familjers vapen i kröningsprocessionen.', 'Vad är ett familjevapen? Vad skulle ert innehålla?'),
(23, -271565087698547, 5, 'Amiralssvärd "Vira" — ett ceremoniellt svärd som visade dess bärares rang. Svärd var lika mycket symboler som vapen.', 'Skilj mellan ett stridssvärd och ett ceremonisvärd. Vad är skillnaden?'),
(23, -281304134560360, 6, 'Hertig Karls dräkt från Dianas fest 1778 — "En Wildes Klädning". Hovfester hade teman och alla klädde ut sig. Makten visades genom att kosta på sig.', 'Varför tror ni att kungliga hade maskerader och temafester?'),
(23, -281207303109992, 7, 'En svensk hovvagn — berlinare à bateau. Överdragen med svart kläde för sorgbruk. Även sorg hade sina symboler och ceremonier.', 'Vilka symboler använder vi idag vid begravningar?'),
(23, -281181493883421, 8, 'En jaktvagn — kungens fritidsfordon. Jakt var kungligt privilegium och ett sätt att visa fysisk styrka och mod.', 'Vilka "fritidssysselsättningar" visar status idag?'),
(23, -280510513949778, 9, 'En gardin från drottning Kristinas kröningskaross med trofémotiv. Kröningsvagnen var maktens rullande scen genom Stockholm.', 'Jämför kröningsprocessionen med en modern statschefs installation. Vad är likt och olikt?'),
(23, -280486389387974, 10, 'Ryska överdrag till muskötlås taget som krigsbyte vid slaget vid Saladen 1703. Krigsbyte visades upp som bevis på seger.', 'Varför tog man hem föremål från fienden? Vad symboliserade det?');

-- Walk 24: Hantverk genom tiderna (Nordiska, åk 4-6) — 10 verk
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(24, -279272977790077, 1, 'En folkdräkt från Uppland — varje landskap hade sin egen dräkt med unika mönster, färger och broderier. Dräkten berättade varifrån du kom.', 'Finns det kläder idag som berättar var du kommer ifrån?'),
(24, -23624018581302, 2, 'Delsbodräkten från Hälsingland — en av Sveriges mest kända folkdräkter med sina starka röda och blå färger.', 'Vilka färger syns mest? Varför tror ni att man valde just de färgerna?'),
(24, -279474904544095, 3, 'En kjol som del av en folkdräkt — vävd och färgad för hand. Att tillverka tyget tog veckor eller månader.', 'Hur lång tid tror ni det tog att göra den här kjolen? Jämför med hur kläder görs idag.'),
(24, -279023854242447, 4, 'Broderi — handarbete som var både konst och vardagssyssla. Flickor lärde sig brodera redan som barn.', 'Har ni provat att brodera eller sy? Vad var svårast?'),
(24, -280826168065510, 5, 'En kolt — den samiska dräkten. Kolten varierar mellan olika samiska grupper och berättar om bärarens hemort och familj.', 'Vad har kolten gemensamt med folkdräkter? Vad skiljer dem åt?'),
(24, -51103653767433, 6, 'Ett bröstsmycke — handgjort silverarbete. Smycken var ofta det mest värdefulla en person ägde och ärvdes genom generationer.', 'Har ni ärvt något smycke eller föremål? Vad betyder det för er?'),
(24, -18620248296664, 7, 'Ett halsband — smycken berättar om mode, status och hantverk. Materialet avslöjar ägarens position i samhället.', 'Vilka material användes? Vad säger materialet om vem som bar det?'),
(24, -100324611101691, 8, 'En klänning — mode förändras ständigt. Den här klänningen visar en tids ideal om hur en kvinna skulle se ut.', 'Hur skiljer sig den här klänningen från kläder ni bär? Vad har förändrats?'),
(24, -244814997994863, 9, 'Ett täcke — vävt eller sytt för hand. Textilier var dyrbara och användes tills de var helt utslitna, sedan återvanns materialet.', 'Vad gör ni med kläder som blivit för små eller trasiga?'),
(24, -280687036967966, 10, 'En bandvävsked — ett verktyg för att väva smala band till dräkter och dekorationer. Verktygen var ofta lika vackra som det de tillverkade.', 'Varför tror ni att man lade ner tid på att göra verktygen vackra?');

-- Walk 25: Migration och möten (Nordiska, åk 7-9) — 10 verk
INSERT INTO walk_items (walk_id, artwork_id, position, narrative_text, discussion_question) VALUES
(25, -277927861017934, 1, 'En samisk trumma — ceremoniellt föremål med djup kulturell betydelse. Samerna är Nordens urfolk och har bott här i tusentals år.', 'Vad vet ni om samisk kultur? Var finns samer idag?'),
(25, -279560090292672, 2, 'Lappstaden i Arvidsjaur — en samisk kyrkstad med traditionella byggnader. Hit kom samerna för marknader och kyrkbesök.', 'Varför hade samerna egna kyrkstäder? Vad berättar det om deras liv?'),
(25, -279531626642496, 3, 'En ren och en same på Bromma flygplats 1678 — ett möte mellan tradition och modernitet som säger mycket om hur Sverige förändrades.', 'Vad berättar den här bilden om mötet mellan gammalt och nytt?'),
(25, -278728982886772, 4, 'Bilder från Lungo Drom, ett romskt läger i Örby, Älvsjö. Romer har levt i Sverige sedan 1500-talet men deras historia berättas sällan.', 'Varför tror ni att vissa gruppers historia berättas mer än andras?'),
(25, -175952146242586, 5, 'Skyltfönster på Nordiska Kompaniet — NK var en mötesplats för internationellt mode och svensk design. Handel har alltid fört kulturer samman.', 'Vilka internationella influenser ser ni i svenska affärer idag?'),
(25, -105216663177886, 6, 'Modell i svart alpackadräkt från NK:s Franska damskrädderiet, original Givenchy. Franskt mode anpassat för svenska kvinnor — ett kulturmöte i textil.', 'Varför importerade Sverige mode från Frankrike? Gör vi det fortfarande?'),
(25, -141194536254258, 7, 'Modevisning med modell i rosa dräkt från Balmain. Internationella modehus visade sina kreationer i Stockholm.', 'Vad säger internationellt mode om globalisering?'),
(25, -44597982886561, 8, 'Textilindustri — arbete på Tuppens Väf i Norrköping. Textilindustrin lockade arbetare från hela Europa till svenska fabriksstäder.', 'Vilka jobb lockar människor att flytta idag?'),
(25, -274157669440158, 9, 'Dammode — röd klänning med virkad cape. Svenskt mode har alltid inspirerats av och inspirerat andra länder.', 'Finns det något ni tänker på som "typiskt svenskt"? Var kommer det ifrån egentligen?'),
(25, -76519782052687, 10, 'En klänning som visar hur mode vandrar mellan kulturer och tidsperioder. Varje plagg bär spår av de människor och traditioner som format det.', 'Titta på era egna kläder — kan ni hitta influenser från andra länder eller kulturer?');
