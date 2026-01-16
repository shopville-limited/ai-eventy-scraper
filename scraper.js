// AI Eventy Scraper - Zjednodušená verze
// Načítá data z aiakce.cz a ukládá je do Supabase

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

// Kontrola proměnných prostředí
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('❌ CHYBA: Chybí SUPABASE_URL nebo SUPABASE_KEY');
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'nastaveno' : 'CHYBÍ');
  console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'nastaveno' : 'CHYBÍ');
  process.exit(1);
}

// Supabase připojení
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function scrapeAIEvents() {
  console.log('🚀 Začínám scraping...');
  console.log('📍 Zdroj: https://www.aiakce.cz/seznam/');
  
  try {
    // Načtení HTML ze zdroje
    console.log('📥 Stahuji HTML...');
    const response = await fetch('https://www.aiakce.cz/seznam/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP chyba! Status: ${response.status}`);
    }
    
    const html = await response.text();
    console.log(`✅ HTML načteno (${html.length} znaků)`);
    
    const $ = cheerio.load(html);
    const events = [];
    
    // Zkusíme najít akce - různé možné selektory
    const eventElements = $('article.tribe-events-calendar-list__event-row, .tribe-common-g-row').toArray();
    console.log(`🔍 Nalezeno ${eventElements.length} potenciálních akcí`);
    
    if (eventElements.length === 0) {
      console.warn('⚠️ Nenalezeny žádné akce. Zkouším alternativní metodu...');
      // Zkusíme najít jakékoliv linky na akce
      $('a[href*="aiakce.cz"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href && !href.includes('/seznam/')) {
          console.log(`  Našel jsem odkaz: ${href}`);
        }
      });
    }
    
    // Projdeme všechny akce
    for (let i = 0; i < eventElements.length; i++) {
      try {
        const $event = $(eventElements[i]);
        
        // Extrakce dat - flexibilní selektory
        const titleElement = $event.find('h3 a, .tribe-events-calendar-list__event-title-link, a.tribe-common-anchor-thin').first();
        const title = titleElement.text().trim();
        const externalUrl = titleElement.attr('href');
        
        // Pokud nemáme základní data, přeskočíme
        if (!title || !externalUrl) {
          continue;
        }
        
        // Datum
        const dateElement = $event.find('time, .tribe-event-date-start');
        const dateText = dateElement.attr('datetime') || dateElement.text().trim();
        
        // Místo
        const location = $event.find('.tribe-events-calendar-list__event-venue-title, .tribe-venue').text().trim();
        const address = $event.find('.tribe-events-calendar-list__event-venue-address, .tribe-address').text().trim();
        
        // Popis
        const description = $event.find('.tribe-events-calendar-list__event-description, p').first().text().trim();
        
        // Obrázek
        const imageUrl = $event.find('img').first().attr('src');
        
        // Cena
        const priceText = $event.find('.tribe-events-c-small-cta__price, .tribe-events-cost').text().trim();
        
        // Zpracování data
        let eventDate = null;
        let eventTime = null;
        
        if (dateText) {
          try {
            const date = new Date(dateText);
            if (!isNaN(date)) {
              eventDate = date.toISOString().split('T')[0];
              eventTime = date.toTimeString().split(' ')[0].substring(0, 5);
            }
          } catch (e) {
            console.warn(`  ⚠️ Nepodařilo se zpracovat datum: ${dateText}`);
          }
        }
        
        // Pokud nemáme datum, použijeme dnešek + 7 dní (fallback)
        if (!eventDate) {
          const futureDate = new Date();
          futureDate.setDate(futureDate.getDate() + 7);
          eventDate = futureDate.toISOString().split('T')[0];
        }
        
        // Extrakce města
        let city = '';
        if (location) {
          city = location.split(',')[0].trim();
        } else if (address) {
          const parts = address.split(',');
          city = parts[parts.length - 1].trim();
        }
        
        // Určení typu akce
        const titleLower = title.toLowerCase();
        const locationLower = (location + ' ' + address).toLowerCase();
        
        let eventType = 'meetup';
        if (titleLower.includes('konference') || titleLower.includes('conference')) {
          eventType = 'conference';
        } else if (titleLower.includes('workshop')) {
          eventType = 'workshop';
        } else if (titleLower.includes('webinář') || titleLower.includes('webinar')) {
          eventType = 'webinar';
        }
        
        const isOnline = locationLower.includes('online') || 
                        eventType === 'webinar' || 
                        city.toLowerCase() === 'online';
        
        if (isOnline && !city) {
          city = 'Online';
        }
        
        const eventData = {
          title: title.substring(0, 255),
          event_date: eventDate,
          event_time: eventTime,
          location: (location || address || 'Neuvedeno').substring(0, 255),
          city: city || 'Neuvedeno',
          description: description.substring(0, 500),
          external_url: externalUrl,
          image_url: imageUrl || null,
          price: priceText || null,
          event_type: eventType,
          is_online: isOnline,
          updated_at: new Date().toISOString()
        };
        
        events.push(eventData);
        console.log(`  ✓ ${i + 1}. ${title.substring(0, 50)}...`);
        
      } catch (err) {
        console.error(`  ✗ Chyba při zpracování akce #${i + 1}:`, err.message);
      }
    }
    
    console.log(`\n📊 Výsledek: Načteno ${events.length} akcí`);
    
    if (events.length === 0) {
      console.warn('⚠️ Nenašly se žádné akce k uložení');
      return 0;
    }
    
    // Uložení do Supabase
    console.log('💾 Ukládám do Supabase...');
    
    // Nejdřív smažeme všechny staré akce
    const { error: deleteError } = await supabase
      .from('events')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Smaže všechno
    
    if (deleteError) {
      console.warn('⚠️ Varování při mazání:', deleteError.message);
    } else {
      console.log('  🗑️ Staré akce smazány');
    }
    
    // Vložíme nové akce po jedné (bezpečnější)
    let successCount = 0;
    for (const event of events) {
      const { error } = await supabase
        .from('events')
        .insert(event);
      
      if (error) {
        console.error(`  ✗ Chyba při ukládání "${event.title}":`, error.message);
      } else {
        successCount++;
      }
    }
    
    console.log(`✅ Úspěšně uloženo: ${successCount}/${events.length} akcí`);
    console.log('🎉 Scraping dokončen!');
    
    return successCount;
    
  } catch (error) {
    console.error('❌ KRITICKÁ CHYBA:', error.message);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

// Spuštění s detailním logováním
console.log('='.repeat(50));
console.log('🤖 AI Eventy Scraper');
console.log('='.repeat(50));

scrapeAIEvents()
  .then(count => {
    console.log('='.repeat(50));
    console.log(`✨ HOTOVO: Zpracováno ${count} akcí`);
    console.log('='.repeat(50));
    process.exit(0);
  })
  .catch(error => {
    console.log('='.repeat(50));
    console.error('💥 SELHÁNÍ:', error.message);
    console.log('='.repeat(50));
    process.exit(1);
  });
