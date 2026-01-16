// AI Eventy Scraper
// Načítá data z aiakce.cz a ukládá je do Supabase

import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';

// Supabase připojení
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function scrapeAIEvents() {
  console.log('🚀 Začínám scraping...');
  
  try {
    // Načtení HTML ze zdroje
    const response = await fetch('https://www.aiakce.cz/seznam/');
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const events = [];
    
    // Projdeme všechny akce na stránce
    $('.tribe-events-calendar-list__event-row').each((i, element) => {
      try {
        const $event = $(element);
        
        // Extrakce dat
        const title = $event.find('.tribe-events-calendar-list__event-title-link').text().trim();
        const externalUrl = $event.find('.tribe-events-calendar-list__event-title-link').attr('href');
        const dateText = $event.find('.tribe-event-date-start').attr('datetime') || 
                        $event.find('.tribe-events-calendar-list__event-date-tag-datetime').attr('datetime');
        const location = $event.find('.tribe-events-calendar-list__event-venue-title').text().trim();
        const address = $event.find('.tribe-events-calendar-list__event-venue-address').text().trim();
        const description = $event.find('.tribe-events-calendar-list__event-description').text().trim();
        const imageUrl = $event.find('.tribe-events-calendar-list__event-featured-image img').attr('src');
        const priceText = $event.find('.tribe-events-c-small-cta__price').text().trim();
        
        // Pokud nemáme základní data, přeskočíme
        if (!title || !externalUrl) return;
        
        // Zpracování data
        let eventDate = null;
        let eventTime = null;
        if (dateText) {
          const date = new Date(dateText);
          eventDate = date.toISOString().split('T')[0];
          eventTime = date.toTimeString().split(' ')[0].substring(0, 5);
        }
        
        // Extrakce města
        let city = '';
        if (location) {
          city = location.split(',')[0].trim();
        } else if (address) {
          const cityMatch = address.match(/,\s*([^,]+)\s*$/);
          if (cityMatch) city = cityMatch[1].trim();
        }
        
        // Určení typu akce a zda je online
        const titleLower = title.toLowerCase();
        const locationLower = (location + ' ' + address).toLowerCase();
        
        let eventType = 'meetup';
        if (titleLower.includes('konference') || titleLower.includes('conference')) eventType = 'conference';
        else if (titleLower.includes('workshop')) eventType = 'workshop';
        else if (titleLower.includes('webinář') || titleLower.includes('webinar')) eventType = 'webinar';
        
        const isOnline = locationLower.includes('online') || 
                        eventType === 'webinar' || 
                        city.toLowerCase() === 'online';
        
        if (isOnline && !city) city = 'Online';
        
        events.push({
          title,
          event_date: eventDate,
          event_time: eventTime,
          location: location || address,
          city,
          description: description.substring(0, 500), // Max 500 znaků
          external_url: externalUrl,
          image_url: imageUrl || null,
          price: priceText || null,
          event_type: eventType,
          is_online: isOnline,
          updated_at: new Date().toISOString()
        });
        
      } catch (err) {
        console.error('Chyba při zpracování akce:', err.message);
      }
    });
    
    console.log(`✅ Načteno ${events.length} akcí`);
    
    // Uložení do Supabase
    if (events.length > 0) {
      // Smazání starých akcí (starší než včera)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const { error: deleteError } = await supabase
        .from('events')
        .delete()
        .lt('event_date', yesterday.toISOString().split('T')[0]);
      
      if (deleteError) console.warn('Varování při mazání starých akcí:', deleteError.message);
      
      // Vložení nových akcí (upsert - aktualizuje pokud existuje)
      const { data, error } = await supabase
        .from('events')
        .upsert(events, { 
          onConflict: 'external_url',
          ignoreDuplicates: false 
        });
      
      if (error) {
        console.error('❌ Chyba při ukládání do Supabase:', error.message);
        throw error;
      }
      
      console.log(`💾 Uloženo do databáze`);
    }
    
    console.log('🎉 Scraping dokončen!');
    return events.length;
    
  } catch (error) {
    console.error('❌ Chyba při scrapingu:', error.message);
    throw error;
  }
}

// Spuštění
scrapeAIEvents()
  .then(count => {
    console.log(`✨ Celkem zpracováno: ${count} akcí`);
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Kritická chyba:', error);
    process.exit(1);
  });
